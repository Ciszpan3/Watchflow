import { google, youtube_v3 } from "googleapis";
import { createOAuthClient } from "./googleOAuth.js";
import { calculateEngagementRate, calculateOpportunityScore, calculateViewsPerSubscriber } from "./metrics.js";
import type { ChannelSummary, VideoPerformance } from "../types.js";

export async function exchangeCodeForTokens(code: string) {
  const client = createOAuthClient();
  const { tokens } = await client.getToken(code);
  return tokens;
}

export function createYoutubeClient(accessToken: string) {
  const auth = createOAuthClient();
  auth.setCredentials({ access_token: accessToken });
  return google.youtube({ version: "v3", auth });
}

export async function getAuthenticatedChannel(youtube: youtube_v3.Youtube): Promise<ChannelSummary | null> {
  const response = await youtube.channels.list({
    mine: true,
    part: ["snippet", "contentDetails", "statistics"]
  });

  const item = response.data.items?.[0];
  if (!item?.id || !item.snippet || !item.statistics) {
    return null;
  }

  return {
    id: item.id,
    title: item.snippet.title ?? "Untitled channel",
    description: item.snippet.description ?? "",
    thumbnailUrl: item.snippet.thumbnails?.default?.url ?? "",
    subscriberCount: Number(item.statistics.subscriberCount ?? 0),
    viewCount: Number(item.statistics.viewCount ?? 0),
    videoCount: Number(item.statistics.videoCount ?? 0),
    lastSyncedAt: new Date().toISOString()
  };
}

export function mapVideoItem(item: youtube_v3.Schema$Video, subscriberCount: number): VideoPerformance | null {
  if (!item.id || !item.snippet || !item.statistics) {
    return null;
  }

  const views = Number(item.statistics.viewCount ?? 0);
  const likes = Number(item.statistics.likeCount ?? 0);
  const comments = Number(item.statistics.commentCount ?? 0);
  const engagementRate = calculateEngagementRate(views, likes, comments);
  const viewsPerSubscriber = calculateViewsPerSubscriber(views, subscriberCount);

  const video = {
    id: item.id,
    title: item.snippet.title ?? "Untitled video",
    publishedAt: item.snippet.publishedAt ?? new Date().toISOString(),
    thumbnailUrl: item.snippet.thumbnails?.medium?.url ?? item.snippet.thumbnails?.default?.url ?? "",
    durationSeconds: parseIsoDurationToSeconds(item.contentDetails?.duration ?? "PT0S"),
    views,
    likes,
    comments,
    engagementRate,
    viewsPerSubscriber,
    opportunityScore: 0
  };

  return {
    ...video,
    opportunityScore: calculateOpportunityScore(video)
  };
}

export function parseIsoDurationToSeconds(duration: string) {
  const match = duration.match(/PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?/);
  if (!match) {
    return 0;
  }

  const hours = Number(match[1] ?? 0);
  const minutes = Number(match[2] ?? 0);
  const seconds = Number(match[3] ?? 0);

  return hours * 3600 + minutes * 60 + seconds;
}
