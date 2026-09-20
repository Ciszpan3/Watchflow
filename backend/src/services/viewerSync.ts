import type { youtube_v3 } from "googleapis";
import { env } from "../config/env.js";
import { db } from "../db.js";
import { SyncStatus, VideoSource } from "../generated/prisma/enums.js";
import { isInvalidGrant, upsertChannels, upsertVideo, videoDetails, youtubeForUser } from "./youtubeLive.js";

const runningJobs = new Map<string, Promise<void>>();

type SyncError = Error & { code?: string };

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
  const channelIds: string[] = [];
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
      if (channelId) channelIds.push(channelId);
    }
    pageToken = response.data.nextPageToken ?? undefined;
  } while (pageToken);
  return [...new Set(channelIds)];
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

function chunksOf<T>(values: T[], size: number) {
  return Array.from({ length: Math.ceil(values.length / size) }, (_, index) => values.slice(index * size, (index + 1) * size));
}

async function runSync(userId: string, jobId: string) {
  const deadline = Date.now() + env.syncJobTimeoutMinutes * 60 * 1000;
  const assertActive = () => assertSyncActive(deadline);

  try {
    await db.syncJob.update({ where: { id: jobId }, data: { status: SyncStatus.RUNNING, phase: "subscriptions" } });
    const youtube = await youtubeForUser(userId);
    const channelIds = await fetchSubscriptions(youtube, assertActive);
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

    const account = await db.googleAccount.findUniqueOrThrow({ where: { userId } });
    const preferred = validChannelIds.filter((id) => likedChannelIds.has(id));
    const remaining = validChannelIds.filter((id) => !likedChannelIds.has(id));
    const selectedIds = [...preferred.slice(0, 20), ...rotate(remaining, account.syncCursor, 40 - Math.min(20, preferred.length))].slice(0, 40);
    const selectedChannels = channels.filter((channel) => channel.id && selectedIds.includes(channel.id));
    const uploadVideoIdsByChannel = await mapWithConcurrency(selectedChannels, env.syncConcurrency, async (channel) => {
      assertActive();
      const playlistId = channel.contentDetails?.relatedPlaylists?.uploads;
      if (!playlistId) return [];
      try {
        const response = await youtube.playlistItems.list({
          playlistId,
          part: ["contentDetails"],
          maxResults: 3
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
    const expiresAt = new Date(Date.now() + env.syncCacheHours * 60 * 60 * 1000);
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
