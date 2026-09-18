import type { youtube_v3 } from "googleapis";
import { env } from "../config/env.js";
import { db } from "../db.js";
import { SyncStatus, VideoSource } from "../generated/prisma/enums.js";
import { isInvalidGrant, upsertChannel, upsertVideo, videoDetails, youtubeForUser } from "./youtubeLive.js";

const runningJobs = new Map<string, Promise<void>>();

async function fetchSubscriptions(youtube: youtube_v3.Youtube) {
  const channelIds: string[] = [];
  let pageToken: string | undefined;
  do {
    const response = await youtube.subscriptions.list({
      mine: true,
      part: ["snippet", "contentDetails"],
      maxResults: 50,
      pageToken
    });
    for (const item of response.data.items ?? []) {
      const channelId = item.snippet?.resourceId?.channelId;
      if (channelId) channelIds.push(channelId);
    }
    pageToken = response.data.nextPageToken ?? undefined;
  } while (pageToken);
  return [...new Set(channelIds)];
}

async function fetchLikedVideos(youtube: youtube_v3.Youtube) {
  const items: youtube_v3.Schema$Video[] = [];
  let pageToken: string | undefined;
  do {
    const response = await youtube.videos.list({
      myRating: "like",
      part: ["snippet", "contentDetails", "statistics", "liveStreamingDetails"],
      maxResults: 50,
      pageToken
    });
    items.push(...(response.data.items ?? []));
    pageToken = items.length < 200 ? response.data.nextPageToken ?? undefined : undefined;
  } while (pageToken);
  return items.slice(0, 200);
}

function rotate<T>(values: T[], start: number, limit: number) {
  if (!values.length) return [];
  return Array.from({ length: Math.min(limit, values.length) }, (_, index) => values[(start + index) % values.length]);
}

async function runSync(userId: string, jobId: string) {
  try {
    await db.syncJob.update({ where: { id: jobId }, data: { status: SyncStatus.RUNNING, phase: "subscriptions" } });
    const youtube = await youtubeForUser(userId);
    const channelIds = await fetchSubscriptions(youtube);
    const channels: youtube_v3.Schema$Channel[] = [];
    for (let index = 0; index < channelIds.length; index += 50) {
      const response = await youtube.channels.list({
        id: channelIds.slice(index, index + 50),
        part: ["snippet", "contentDetails", "statistics"]
      });
      channels.push(...(response.data.items ?? []));
    }
    for (const channel of channels) await upsertChannel(channel);
    const validChannelIds = channels.map((channel) => channel.id).filter((id): id is string => Boolean(id));
    await db.$transaction([
      db.subscription.deleteMany({ where: { userId, channelId: { notIn: validChannelIds.length ? validChannelIds : ["__none__"] } } }),
      ...validChannelIds.map((channelId) => db.subscription.upsert({
        where: { userId_channelId: { userId, channelId } },
        update: { lastCheckedAt: new Date() },
        create: { userId, channelId }
      }))
    ]);
    await db.syncJob.update({ where: { id: jobId }, data: { subscriptionsCount: validChannelIds.length, phase: "likes" } });

    const likedItems = await fetchLikedVideos(youtube);
    const likedVideoIds: string[] = [];
    const likedChannelIds = new Set<string>();
    for (const item of likedItems) {
      const video = await upsertVideo(item);
      if (video) {
        likedVideoIds.push(video.id);
        likedChannelIds.add(video.channelId);
      }
    }
    await db.$transaction([
      db.likedVideo.deleteMany({ where: { userId } }),
      ...likedVideoIds.map((videoId) => db.likedVideo.create({ data: { userId, videoId } }))
    ]);
    await db.syncJob.update({ where: { id: jobId }, data: { likedVideosCount: likedVideoIds.length, phase: "recent_videos" } });

    const account = await db.googleAccount.findUniqueOrThrow({ where: { userId } });
    const preferred = validChannelIds.filter((id) => likedChannelIds.has(id));
    const remaining = validChannelIds.filter((id) => !likedChannelIds.has(id));
    const selectedIds = [...preferred.slice(0, 20), ...rotate(remaining, account.syncCursor, 40 - Math.min(20, preferred.length))].slice(0, 40);
    const selectedChannels = channels.filter((channel) => channel.id && selectedIds.includes(channel.id));
    const uploadVideoIds: string[] = [];
    for (const channel of selectedChannels) {
      const playlistId = channel.contentDetails?.relatedPlaylists?.uploads;
      if (!playlistId) continue;
      const response = await youtube.playlistItems.list({
        playlistId,
        part: ["contentDetails"],
        maxResults: 3
      });
      for (const item of response.data.items ?? []) {
        if (item.contentDetails?.videoId) uploadVideoIds.push(item.contentDetails.videoId);
      }
    }
    const recentItems = await videoDetails(youtube, [...new Set(uploadVideoIds)]);
    const expiresAt = new Date(Date.now() + env.syncCacheHours * 60 * 60 * 1000);
    let candidatesCount = 0;
    for (const item of recentItems) {
      const video = await upsertVideo(item);
      if (!video) continue;
      await db.userVideoCandidate.upsert({
        where: { userId_videoId_source: { userId, videoId: video.id, source: VideoSource.SUBSCRIBED } },
        update: { discoveredAt: new Date(), expiresAt },
        create: { userId, videoId: video.id, source: VideoSource.SUBSCRIBED, expiresAt }
      });
      candidatesCount += 1;
    }
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
    const reconnect = isInvalidGrant(error) || (error as { code?: string }).code === "reconnect_required";
    if (reconnect) await db.googleAccount.updateMany({ where: { userId }, data: { needsReconnect: true } });
    await db.syncJob.update({
      where: { id: jobId },
      data: {
        status: SyncStatus.FAILED,
        activeKey: null,
        phase: "failed",
        errorCode: reconnect ? "reconnect_required" : "youtube_error",
        errorMessage: error instanceof Error ? error.message.slice(0, 500) : "Unknown synchronization error",
        finishedAt: new Date()
      }
    });
  } finally {
    runningJobs.delete(userId);
  }
}

export async function requestViewerSync(userId: string, force = false) {
  const running = await db.syncJob.findFirst({ where: { userId, status: { in: [SyncStatus.QUEUED, SyncStatus.RUNNING] } }, orderBy: { startedAt: "desc" } });
  if (running || runningJobs.has(userId)) return { status: "already_running" as const, jobId: running?.id ?? null };
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
