import type { youtube_v3 } from "googleapis";
import { env } from "../config/env.js";
import { db } from "../db.js";
import { SyncStatus, VideoSource } from "../generated/prisma/enums.js";
import { isInvalidGrant, upsertChannels, upsertVideo, videoDetails, youtubeForUser } from "./youtubeLive.js";
import { creatorFamilyName, subscriptionCandidateExpiration } from "./recommendations.js";

const runningJobs = new Map<string, Promise<void>>();

type SyncError = Error & { code?: string };
type SubscriptionSignal = { channelId: string; newItemCount: number };

export async function mapWithConcurrency<T, R>(
  values: T[],
  requestedLimit: number,
  worker: (value: T, index: number) => Promise<R>
) {
  if (!values.length) return [];
  const results = new Array<R>(values.length);
  const limit = Math.min(values.length, Math.max(1, Math.floor(requestedLimit) || 1));
  let nextIndex = 0;

  async function runWorker() {
    while (nextIndex < values.length) {
      const index = nextIndex;
      nextIndex += 1;
      results[index] = await worker(values[index], index);
    }
  }

  await Promise.all(Array.from({ length: limit }, () => runWorker()));
  return results;
}

export function assertSyncActive(deadline: number, now = Date.now()) {
  if (now < deadline) return;
  const error = new Error("YouTube synchronization exceeded its time limit") as SyncError;
  error.code = "sync_timeout";
  throw error;
}

function syncErrorCode(error: unknown) {
  const candidate = error as { code?: string | number; message?: string };
  if (isInvalidGrant(error) || candidate.code === "reconnect_required") return "reconnect_required";
  if (candidate.code === "sync_timeout") return "sync_timeout";
  if (candidate.code === "ETIMEDOUT" || candidate.message?.toLowerCase().includes("timeout")) return "youtube_timeout";
  return "youtube_error";
}

function shouldAbortSync(error: unknown) {
  return syncErrorCode(error) !== "youtube_error";
}

async function fetchSubscriptions(youtube: youtube_v3.Youtube, assertActive: () => void) {
  const subscriptions = new Map<string, number>();
  let pageToken: string | undefined;
  do {
    assertActive();
    const response = await youtube.subscriptions.list({
      mine: true,
      part: ["snippet", "contentDetails"],
      maxResults: 50,
      pageToken
    }, { timeout: env.youtubeRequestTimeoutMs });
    for (const item of response.data.items ?? []) {
      const channelId = item.snippet?.resourceId?.channelId;
      if (channelId) subscriptions.set(channelId, Math.max(
        subscriptions.get(channelId) ?? 0,
        Number(item.contentDetails?.newItemCount ?? 0)
      ));
    }
    pageToken = response.data.nextPageToken ?? undefined;
  } while (pageToken);
  return [...subscriptions.entries()].map(([channelId, newItemCount]) => ({ channelId, newItemCount }));
}

async function fetchLikedVideos(youtube: youtube_v3.Youtube, assertActive: () => void) {
  const items: youtube_v3.Schema$Video[] = [];
  let pageToken: string | undefined;
  do {
    assertActive();
    const response = await youtube.videos.list({
      myRating: "like",
      part: ["snippet", "contentDetails", "statistics", "liveStreamingDetails"],
      maxResults: 50,
      pageToken
    }, { timeout: env.youtubeRequestTimeoutMs });
    items.push(...(response.data.items ?? []));
    pageToken = items.length < 200 ? response.data.nextPageToken ?? undefined : undefined;
  } while (pageToken);
  return items.slice(0, 200);
}

function rotate<T>(values: T[], start: number, limit: number) {
  if (!values.length) return [];
  return Array.from({ length: Math.min(limit, values.length) }, (_, index) => values[(start + index) % values.length]);
}

export function selectSubscriptionChannels(
  subscriptions: SubscriptionSignal[],
  likedChannelIds: Set<string>,
  cursor: number,
  requestedLimit: number,
  frequentChannelIds: string[] = []
) {
  const limit = Math.min(subscriptions.length, Math.max(1, Math.floor(requestedLimit) || 1));
  const availableIds = new Set(subscriptions.map((item) => item.channelId));
  const favorites = frequentChannelIds.filter((channelId) => availableIds.has(channelId)).slice(0, Math.ceil(limit / 2));
  const favoriteSet = new Set(favorites);
  const recent = [...subscriptions]
    .filter((item) => item.newItemCount > 0 && !favoriteSet.has(item.channelId))
    .sort((left, right) => right.newItemCount - left.newItemCount)
    .map((item) => item.channelId);
  const recentSet = new Set(recent);
  const liked = subscriptions
    .map((item) => item.channelId)
    .filter((channelId) => likedChannelIds.has(channelId) && !recentSet.has(channelId));
  const preferredSet = new Set([...favorites, ...recent, ...liked]);
  const remaining = subscriptions.map((item) => item.channelId).filter((channelId) => !preferredSet.has(channelId));
  return [...new Set([...favorites, ...recent, ...liked, ...rotate(remaining, cursor, limit)])].slice(0, limit);
}

export function frequentSubscriptionChannels(
  channels: Array<{ id?: string | null; snippet?: { title?: string | null } | null }>,
  historyRows: Array<{ videoId?: string | null; title: string; channelTitle: string | null; watchedAt: Date }>,
  now = new Date()
) {
  const byFamily = new Map<string, { weighted: number; unique: Set<string>; repeats: Map<string, number> }>();
  for (const row of historyRows) {
    if (!row.channelTitle) continue;
    const family = creatorFamilyName(row.channelTitle);
    if (!family) continue;
    const value = byFamily.get(family) ?? { weighted: 0, unique: new Set<string>(), repeats: new Map<string, number>() };
    const identity = row.videoId ?? row.title.toLowerCase();
    const repeats = value.repeats.get(identity) ?? 0;
    value.unique.add(identity);
    value.repeats.set(identity, repeats + 1);
    if (repeats < 3) {
      const ageDays = Math.max(0, (now.getTime() - row.watchedAt.getTime()) / 86_400_000);
      value.weighted += ageDays <= 90 ? 1 : ageDays <= 365 ? 0.65 : 0.35;
    }
    byFamily.set(family, value);
  }
  return channels.flatMap((channel) => {
    const channelId = channel.id;
    const title = channel.snippet?.title;
    if (!channelId || !title) return [];
    const history = byFamily.get(creatorFamilyName(title));
    if (!history || history.unique.size < 5) return [];
    return [{ channelId, weighted: history.weighted, unique: history.unique.size }];
  }).sort((left, right) => right.weighted - left.weighted || right.unique - left.unique)
    .map((item) => item.channelId);
}

export function subscriptionUploadPageSize(requestedSize: number) {
  return Math.min(50, Math.max(1, Math.floor(requestedSize) || 1));
}

function chunksOf<T>(values: T[], size: number) {
  return Array.from({ length: Math.ceil(values.length / size) }, (_, index) => values.slice(index * size, (index + 1) * size));
}

async function runSync(userId: string, jobId: string) {
  const deadline = Date.now() + env.syncJobTimeoutMinutes * 60 * 1000;
  const assertActive = () => assertSyncActive(deadline);

  try {
    await db.syncJob.update({ where: { id: jobId }, data: { status: SyncStatus.RUNNING, phase: "subscriptions" } });
    const youtube = await youtubeForUser(userId);
    const subscriptionSignals = await fetchSubscriptions(youtube, assertActive);
    const channelIds = subscriptionSignals.map((item) => item.channelId);
    await db.syncJob.update({ where: { id: jobId }, data: { phase: "subscription_channels" } });
    const channelPages = await mapWithConcurrency(chunksOf(channelIds, 50), env.syncConcurrency, async (channelBatch) => {
      assertActive();
      const response = await youtube.channels.list({
        id: channelBatch,
        part: ["snippet", "contentDetails", "statistics"]
      }, { timeout: env.youtubeRequestTimeoutMs });
      return response.data.items ?? [];
    });
    const channels: youtube_v3.Schema$Channel[] = channelPages.flat();
    assertActive();
    await upsertChannels(channels);
    const validChannelIds = channels.map((channel) => channel.id).filter((id): id is string => Boolean(id));
    const checkedAt = new Date();
    await db.$transaction([
      db.subscription.deleteMany({ where: { userId, channelId: { notIn: validChannelIds.length ? validChannelIds : ["__none__"] } } }),
      db.subscription.updateMany({ where: { userId, channelId: { in: validChannelIds } }, data: { lastCheckedAt: checkedAt } }),
      db.subscription.createMany({ data: validChannelIds.map((channelId) => ({ userId, channelId, lastCheckedAt: checkedAt })), skipDuplicates: true })
    ]);
    await db.syncJob.update({ where: { id: jobId }, data: { subscriptionsCount: validChannelIds.length, phase: "likes" } });

    const likedItems = await fetchLikedVideos(youtube, assertActive);
    const likedVideos = await mapWithConcurrency(likedItems, env.syncConcurrency, async (item) => {
      assertActive();
      return upsertVideo(item);
    });
    const validLikedVideos = likedVideos.filter((video): video is NonNullable<typeof video> => Boolean(video));
    const likedVideoIds = validLikedVideos.map((video) => video.id);
    const likedChannelIds = new Set(validLikedVideos.map((video) => video.channelId));
    await db.$transaction([
      db.likedVideo.deleteMany({ where: { userId } }),
      db.likedVideo.createMany({ data: likedVideoIds.map((videoId) => ({ userId, videoId })), skipDuplicates: true })
    ]);
    await db.syncJob.update({ where: { id: jobId }, data: { likedVideosCount: likedVideoIds.length, phase: "recent_videos" } });

    const [account, profile, historyRows] = await Promise.all([
      db.googleAccount.findUniqueOrThrow({ where: { userId } }),
      db.viewerProfile.findUnique({ where: { userId }, select: { useWatchHistory: true } }),
      db.watchHistoryItem.findMany({ where: { userId }, orderBy: { watchedAt: "desc" }, take: 5000 })
    ]);
    const availableSubscriptions = subscriptionSignals.filter((item) => validChannelIds.includes(item.channelId));
    const frequentChannelIds = profile?.useWatchHistory ? frequentSubscriptionChannels(channels, historyRows) : [];
    const selectedIds = selectSubscriptionChannels(availableSubscriptions, likedChannelIds, account.syncCursor, env.subscriptionChannelLimit, frequentChannelIds);
    const selectedChannels = channels.filter((channel) => channel.id && selectedIds.includes(channel.id));
    const uploadVideoIdsByChannel = await mapWithConcurrency(selectedChannels, env.syncConcurrency, async (channel) => {
      assertActive();
      const playlistId = channel.contentDetails?.relatedPlaylists?.uploads;
      if (!playlistId) return [];
      try {
        const response = await youtube.playlistItems.list({
          playlistId,
          part: ["contentDetails"],
          maxResults: subscriptionUploadPageSize(env.subscriptionVideosPerChannel)
        }, { timeout: env.youtubeRequestTimeoutMs });
        return (response.data.items ?? [])
          .map((item) => item.contentDetails?.videoId)
          .filter((videoId): videoId is string => Boolean(videoId));
      } catch (error) {
        if (shouldAbortSync(error)) throw error;
        console.warn(`Skipping uploads playlist ${playlistId} during synchronization.`);
        return [];
      }
    });
    const uploadVideoIds = uploadVideoIdsByChannel.flat();
    const recentItems = await videoDetails(youtube, [...new Set(uploadVideoIds)], assertActive);
    await db.syncJob.update({ where: { id: jobId }, data: { phase: "saving_candidates" } });
    const expiresAt = subscriptionCandidateExpiration();
    const savedCandidates = await mapWithConcurrency(recentItems, env.syncConcurrency, async (item) => {
      assertActive();
      const video = await upsertVideo(item);
      if (!video) return false;
      await db.userVideoCandidate.upsert({
        where: { userId_videoId_source: { userId, videoId: video.id, source: VideoSource.SUBSCRIBED } },
        update: { discoveredAt: new Date(), expiresAt },
        create: { userId, videoId: video.id, source: VideoSource.SUBSCRIBED, expiresAt }
      });
      return true;
    });
    const candidatesCount = savedCandidates.filter(Boolean).length;
    const now = new Date();
    await db.$transaction([
      db.googleAccount.update({
        where: { userId },
        data: { lastSyncedAt: now, syncCursor: validChannelIds.length ? (account.syncCursor + selectedIds.length) % validChannelIds.length : 0, needsReconnect: false }
      }),
      db.syncJob.update({
        where: { id: jobId },
        data: { status: SyncStatus.SUCCEEDED, activeKey: null, phase: "complete", candidatesCount, finishedAt: now }
      })
    ]);
  } catch (error) {
    const errorCode = syncErrorCode(error);
    const reconnect = errorCode === "reconnect_required";
    if (reconnect) await db.googleAccount.updateMany({ where: { userId }, data: { needsReconnect: true } });
    await db.syncJob.update({
      where: { id: jobId },
      data: {
        status: SyncStatus.FAILED,
        activeKey: null,
        phase: "failed",
        errorCode,
        errorMessage: error instanceof Error ? error.message.slice(0, 500) : "Unknown synchronization error",
        finishedAt: new Date()
      }
    });
  } finally {
    runningJobs.delete(userId);
  }
}

export async function recoverOrphanedSyncJobs(errorCode = "server_restarted") {
  const result = await db.syncJob.updateMany({
    where: { status: { in: [SyncStatus.QUEUED, SyncStatus.RUNNING] } },
    data: {
      status: SyncStatus.FAILED,
      activeKey: null,
      phase: "failed",
      errorCode,
      errorMessage: "Synchronization was interrupted. Start it again to continue.",
      finishedAt: new Date()
    }
  });
  return result.count;
}

export async function requestViewerSync(userId: string, force = false) {
  if (runningJobs.has(userId)) {
    const running = await db.syncJob.findFirst({ where: { userId, status: { in: [SyncStatus.QUEUED, SyncStatus.RUNNING] } }, orderBy: { startedAt: "desc" } });
    return { status: "already_running" as const, jobId: running?.id ?? null };
  }

  const orphaned = await db.syncJob.findFirst({
    where: { userId, status: { in: [SyncStatus.QUEUED, SyncStatus.RUNNING] } },
    orderBy: { startedAt: "desc" }
  });
  if (orphaned) {
    const staleBefore = Date.now() - env.syncJobTimeoutMinutes * 60 * 1000;
    if (orphaned.startedAt.getTime() > staleBefore) {
      return { status: "already_running" as const, jobId: orphaned.id };
    }
    await db.syncJob.update({
      where: { id: orphaned.id },
      data: {
        status: SyncStatus.FAILED,
        activeKey: null,
        phase: "failed",
        errorCode: "orphaned_job",
        errorMessage: "The previous synchronization was interrupted. A new attempt can now start.",
        finishedAt: new Date()
      }
    });
  }

  const account = await db.googleAccount.findUnique({ where: { userId } });
  if (!account?.encryptedRefreshToken || account.needsReconnect) return { status: "reconnect_required" as const, jobId: null };
  const cooldownUntil = account.lastSyncedAt
    ? new Date(account.lastSyncedAt.getTime() + env.syncCooldownMinutes * 60 * 1000)
    : null;
  if (force && cooldownUntil && cooldownUntil > new Date()) {
    return { status: "cooldown" as const, jobId: null, nextAllowedAt: cooldownUntil.toISOString() };
  }
  const staleAt = account.lastSyncedAt
    ? new Date(account.lastSyncedAt.getTime() + env.syncCacheHours * 60 * 60 * 1000)
    : null;
  if (!force && staleAt && staleAt > new Date()) return { status: "fresh" as const, jobId: null };
  let job;
  try {
    job = await db.syncJob.create({ data: { userId, activeKey: userId, status: SyncStatus.QUEUED } });
  } catch (error) {
    if ((error as { code?: string }).code === "P2002") return { status: "already_running" as const, jobId: null };
    throw error;
  }
  const promise = runSync(userId, job.id);
  runningJobs.set(userId, promise);
  void promise;
  return { status: "queued" as const, jobId: job.id };
}
