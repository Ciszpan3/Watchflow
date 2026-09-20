import type { youtube_v3 } from "googleapis";
import { env } from "../config/env.js";
import { db } from "../db.js";
import { Prisma } from "../generated/prisma/client.js";
import { classifyVideo } from "./classification.js";
import { decryptSecret } from "./security.js";
import { createYoutubeClientWithRefreshToken } from "./youtube.js";

export async function youtubeForUser(userId: string) {
  const account = await db.googleAccount.findUnique({ where: { userId } });
  if (!account?.encryptedRefreshToken || account.needsReconnect) {
    const error = new Error("YouTube connection needs to be restored");
    Object.assign(error, { code: "reconnect_required" });
    throw error;
  }
  return createYoutubeClientWithRefreshToken(decryptSecret(account.encryptedRefreshToken));
}

export function isInvalidGrant(error: unknown) {
  if (!error || typeof error !== "object") return false;
  const candidate = error as { code?: string | number; message?: string; response?: { data?: { error?: string } } };
  return candidate.response?.data?.error === "invalid_grant"
    || candidate.message?.includes("invalid_grant")
    || candidate.code === 401;
}

export async function upsertChannel(item: youtube_v3.Schema$Channel) {
  if (!item.id) return null;
  return db.channel.upsert({
    where: { id: item.id },
    update: {
      title: item.snippet?.title ?? "Untitled channel",
      description: item.snippet?.description ?? null,
      thumbnailUrl: item.snippet?.thumbnails?.default?.url ?? null,
      uploadPlaylistId: item.contentDetails?.relatedPlaylists?.uploads ?? null,
      subscriberCount: item.statistics?.subscriberCount ? BigInt(item.statistics.subscriberCount) : null
    },
    create: {
      id: item.id,
      title: item.snippet?.title ?? "Untitled channel",
      description: item.snippet?.description ?? null,
      thumbnailUrl: item.snippet?.thumbnails?.default?.url ?? null,
      uploadPlaylistId: item.contentDetails?.relatedPlaylists?.uploads ?? null,
      subscriberCount: item.statistics?.subscriberCount ? BigInt(item.statistics.subscriberCount) : null
    }
  });
}

export async function upsertChannels(items: youtube_v3.Schema$Channel[]) {
  const now = new Date();
  const rows = items.flatMap((item) => item.id ? [Prisma.sql`(
    ${item.id},
    ${item.snippet?.title ?? "Untitled channel"},
    ${item.snippet?.description ?? null},
    ${item.snippet?.thumbnails?.default?.url ?? null},
    ${item.contentDetails?.relatedPlaylists?.uploads ?? null},
    ${item.statistics?.subscriberCount ? BigInt(item.statistics.subscriberCount) : null},
    ${now},
    ${now}
  )`] : []);
  if (!rows.length) return;

  await db.$executeRaw(Prisma.sql`
    INSERT INTO "Channel" (
      "id", "title", "description", "thumbnailUrl", "uploadPlaylistId",
      "subscriberCount", "createdAt", "updatedAt"
    )
    VALUES ${Prisma.join(rows)}
    ON CONFLICT ("id") DO UPDATE SET
      "title" = EXCLUDED."title",
      "description" = EXCLUDED."description",
      "thumbnailUrl" = EXCLUDED."thumbnailUrl",
      "uploadPlaylistId" = EXCLUDED."uploadPlaylistId",
      "subscriberCount" = EXCLUDED."subscriberCount",
      "updatedAt" = EXCLUDED."updatedAt"
  `);
}

export async function upsertVideo(item: youtube_v3.Schema$Video) {
  if (!item.id || !item.snippet?.channelId) return null;
  const classified = classifyVideo(item);
  await db.channel.upsert({
    where: { id: item.snippet.channelId },
    update: { title: item.snippet.channelTitle ?? "Untitled channel" },
    create: { id: item.snippet.channelId, title: item.snippet.channelTitle ?? "Untitled channel" }
  });
  return db.video.upsert({
    where: { id: item.id },
    update: {
      channelId: item.snippet.channelId,
      title: item.snippet.title ?? "Untitled video",
      description: item.snippet.description ?? null,
      thumbnailUrl: item.snippet.thumbnails?.high?.url ?? item.snippet.thumbnails?.medium?.url ?? item.snippet.thumbnails?.default?.url ?? null,
      durationSeconds: classified.durationSeconds,
      publishedAt: item.snippet.publishedAt ? new Date(item.snippet.publishedAt) : null,
      viewCount: item.statistics?.viewCount ? BigInt(item.statistics.viewCount) : null,
      likeCount: item.statistics?.likeCount ? BigInt(item.statistics.likeCount) : null,
      tags: item.snippet.tags ?? [],
      categoryId: item.snippet.categoryId ?? null,
      language: classified.language,
      format: classified.format,
      topics: classified.topics,
      intents: classified.intents,
      audioFriendly: classified.audioFriendly,
      clickbaitScore: classified.clickbaitScore,
      liveBroadcastContent: item.snippet.liveBroadcastContent ?? null,
      fetchedAt: new Date()
    },
    create: {
      id: item.id,
      channelId: item.snippet.channelId,
      title: item.snippet.title ?? "Untitled video",
      description: item.snippet.description ?? null,
      thumbnailUrl: item.snippet.thumbnails?.high?.url ?? item.snippet.thumbnails?.medium?.url ?? item.snippet.thumbnails?.default?.url ?? null,
      durationSeconds: classified.durationSeconds,
      publishedAt: item.snippet.publishedAt ? new Date(item.snippet.publishedAt) : null,
      viewCount: item.statistics?.viewCount ? BigInt(item.statistics.viewCount) : null,
      likeCount: item.statistics?.likeCount ? BigInt(item.statistics.likeCount) : null,
      tags: item.snippet.tags ?? [],
      categoryId: item.snippet.categoryId ?? null,
      language: classified.language,
      format: classified.format,
      topics: classified.topics,
      intents: classified.intents,
      audioFriendly: classified.audioFriendly,
      clickbaitScore: classified.clickbaitScore,
      liveBroadcastContent: item.snippet.liveBroadcastContent ?? null
    }
  });
}

export async function videoDetails(youtube: youtube_v3.Youtube, ids: string[], assertActive?: () => void) {
  const items: youtube_v3.Schema$Video[] = [];
  for (let index = 0; index < ids.length; index += 50) {
    assertActive?.();
    const response = await youtube.videos.list({
      part: ["snippet", "contentDetails", "statistics", "liveStreamingDetails"],
      id: ids.slice(index, index + 50)
    }, { timeout: env.youtubeRequestTimeoutMs });
    items.push(...(response.data.items ?? []));
  }
  return items;
}
