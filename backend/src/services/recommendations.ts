import { createHash } from "node:crypto";
import { env } from "../config/env.js";
import { db } from "../db.js";
import { VideoSource } from "../generated/prisma/enums.js";
import type { Video, Channel } from "../generated/prisma/client.js";
import type { RecommendationRequest, ViewerProfileInput } from "../viewer/contracts.js";
import { serializeProfile } from "../viewer/profile.js";
import { upsertVideo, videoDetails, youtubeForUser } from "./youtubeLive.js";

type Candidate = { source: VideoSource; video: Video & { channel: Channel } };

function dayKeyPacific() {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/Los_Angeles", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
}

async function reserveSearchCall() {
  const dayKey = dayKeyPacific();
  await db.apiQuotaUsage.upsert({
    where: { dayKey_method: { dayKey, method: "search.list" } },
    update: {},
    create: { dayKey, method: "search.list", calls: 0 }
  });
  const reserved = await db.apiQuotaUsage.updateMany({
    where: { dayKey, method: "search.list", calls: { lt: env.searchDailyLimit } },
    data: { calls: { increment: 1 } }
  });
  return reserved.count === 1;
}

function cacheKey(query: string, language: string, format: string | undefined) {
  return createHash("sha256").update(`${query}|${language}|${format ?? "any"}`).digest("hex");
}

async function searchNewVideos(userId: string, request: RecommendationRequest, profile: ViewerProfileInput) {
  const topics = (request.topics.length ? request.topics : [...profile.interests, ...profile.customTopics]).slice(0, 2);
  const languages = request.languages.slice(0, 2);
  const subscriptions = await db.subscription.findMany({ where: { userId }, select: { channelId: true } });
  const subscribedChannels = new Set(subscriptions.map((item) => item.channelId));
  let quotaLimited = false;

  for (const language of languages) {
    const query = `${topics.join("|") || "interesting documentary"} ${request.intent}`.trim();
    const key = cacheKey(query, language, request.formats.length === 1 ? request.formats[0] : undefined);
    const cached = await db.searchCache.findUnique({ where: { cacheKey: key } });
    let ids = cached && cached.expiresAt > new Date() ? cached.videoIds : [];
    if (!ids.length) {
      if (!(await reserveSearchCall())) {
        quotaLimited = true;
        continue;
      }
      const youtube = await youtubeForUser(userId);
      const response = await youtube.search.list({
        part: ["snippet"],
        q: query,
        type: ["video"],
        maxResults: 25,
        order: "relevance",
        relevanceLanguage: language,
        safeSearch: "moderate",
        videoEmbeddable: "true"
      });
      ids = (response.data.items ?? []).map((item) => item.id?.videoId).filter((id): id is string => Boolean(id));
      const details = await videoDetails(youtube, ids);
      ids = [];
      for (const item of details) {
        const video = await upsertVideo(item);
        if (video && !subscribedChannels.has(video.channelId)) ids.push(video.id);
      }
      await db.searchCache.upsert({
        where: { cacheKey: key },
        update: { query, language, format: request.formats.length === 1 ? request.formats[0] : null, videoIds: ids, expiresAt: new Date(Date.now() + env.searchCacheHours * 60 * 60 * 1000) },
        create: { cacheKey: key, query, language, format: request.formats.length === 1 ? request.formats[0] : null, videoIds: ids, expiresAt: new Date(Date.now() + env.searchCacheHours * 60 * 60 * 1000) }
      });
    }
    const expiresAt = new Date(Date.now() + env.searchCacheHours * 60 * 60 * 1000);
    for (const videoId of ids) {
      await db.userVideoCandidate.upsert({
        where: { userId_videoId_source: { userId, videoId, source: VideoSource.NEW } },
        update: { discoveredAt: new Date(), expiresAt },
        create: { userId, videoId, source: VideoSource.NEW, expiresAt }
      });
    }
  }
  return quotaLimited;
}

function overlap(left: string[], right: string[]) {
  return left.filter((value) => right.includes(value));
}

function formatViews(value: bigint | null) {
  const views = Number(value ?? 0);
  return views >= 1_000_000 ? `${(views / 1_000_000).toFixed(1)}M views` : views >= 1_000 ? `${Math.round(views / 1_000)}K views` : `${views} views`;
}

function relativeDate(value: Date | null) {
  if (!value) return "Recently published";
  const days = Math.max(0, Math.floor((Date.now() - value.getTime()) / 86_400_000));
  if (days === 0) return "Today";
  if (days === 1) return "Yesterday";
  if (days < 14) return `${days} days ago`;
  if (days < 60) return `${Math.round(days / 7)} weeks ago`;
  return `${Math.round(days / 30)} months ago`;
}

export function serializeVideo(video: Video & { channel: Channel }, source: "subscribed" | "new", match = 0, reason = "Saved from a previous session.", signals: string[] = []) {
  return {
    id: video.id,
    title: video.title,
    channel: video.channel.title,
    image: video.thumbnailUrl ?? "",
    duration: Math.max(1, Math.ceil(video.durationSeconds / 60)),
    views: formatViews(video.viewCount),
    published: relativeDate(video.publishedAt),
    intents: video.intents,
    source,
    channelSubscribed: source === "subscribed",
    topics: video.topics,
    language: video.language === "pl" ? "pl" : "en",
    format: video.format,
    likedAffinity: 0,
    novelty: source === "new" ? 85 : 35,
    depth: Math.min(100, Math.round(video.durationSeconds / 18)),
    baseReason: reason,
    signals,
    match,
    reason,
    recommendationSignals: signals,
    youtubeUrl: `https://www.youtube.com/watch?v=${video.id}`
  };
}

export async function buildLiveSession(userId: string, request: RecommendationRequest) {
  const storedProfile = await db.viewerProfile.findUniqueOrThrow({ where: { userId } });
  const profile = serializeProfile(storedProfile);
  let quotaLimited = false;
  if (request.source !== "subscribed") quotaLimited = await searchNewVideos(userId, request, profile);

  const [candidateRows, likedRows, feedbackRows, activityRows, savedRows] = await Promise.all([
    db.userVideoCandidate.findMany({ where: { userId, expiresAt: { gt: new Date() } }, include: { video: { include: { channel: true } } } }),
    db.likedVideo.findMany({ where: { userId }, include: { video: true } }),
    db.recommendationFeedback.findMany({ where: { userId }, include: { video: true } }),
    db.viewingActivity.findMany({ where: { userId, createdAt: { gt: new Date(Date.now() - 90 * 86_400_000) } }, include: { video: true } }),
    db.savedVideo.findMany({ where: { userId }, include: { video: true } })
  ]);
  const candidates: Candidate[] = candidateRows.map((row) => ({ source: row.source, video: row.video }));
  const requestedTopics = request.topics.length ? request.topics : [...profile.interests, ...profile.customTopics];
  const likedTopics = likedRows.flatMap((row) => row.video.topics);
  const likedChannels = new Set(likedRows.map((row) => row.video.channelId));
  const openedTopics = activityRows.filter((row) => row.type === "OPENED").flatMap((row) => row.video.topics);
  const savedTopics = savedRows.flatMap((row) => row.video.topics);
  const excludedVideoIds = new Set(feedbackRows.filter((row) => row.reason === "ALREADY_WATCHED").map((row) => row.videoId));
  const dislikedTopics = feedbackRows.filter((row) => row.reason === "NOT_INTERESTED").flatMap((row) => row.video.topics);
  const repeatedChannels = new Set(feedbackRows.filter((row) => row.reason === "TOO_OFTEN").map((row) => row.video.channelId));
  const tooLongUntil = Date.now() - 14 * 86_400_000;
  const avoidLong = feedbackRows.some((row) => row.reason === "TOO_LONG" && row.updatedAt.getTime() > tooLongUntil);

  const scored = candidates.flatMap((candidate) => {
    const source = candidate.source === VideoSource.SUBSCRIBED ? "subscribed" : "new";
    const video = candidate.video;
    if (excludedVideoIds.has(video.id)) return [];
    if (request.source !== "mixed" && request.source !== source) return [];
    if (!request.formats.includes(video.format as never) || !request.languages.includes((video.language === "pl" ? "pl" : "en") as never)) return [];
    if (request.topics.length && !overlap(video.topics, request.topics).length) return [];
    if (overlap(video.topics, profile.excludedTopics).length) return [];
    if (request.audioFriendly && !video.audioFriendly) return [];

    const topicMatches = overlap(video.topics, requestedTopics);
    const intentScore = video.intents.includes(request.intent) ? 30 : 0;
    const topicScore = topicMatches.length ? 25 : 0;
    const affinityRaw = overlap(video.topics, likedTopics).length * 12
      + (likedChannels.has(video.channelId) ? 28 : 0)
      + overlap(video.topics, openedTopics).length * 4
      + overlap(video.topics, savedTopics).length * 6;
    const affinityScore = profile.useLikedVideos ? Math.min(20, affinityRaw / 5) : 10;
    const durationMinutes = Math.max(1, Math.ceil(video.durationSeconds / 60));
    const durationScore = Math.max(0, 15 - Math.max(0, durationMinutes - request.minutes) * 2);
    const novelty = source === "new" ? 85 : 35;
    const depth = Math.min(100, Math.round(video.durationSeconds / 18));
    const alignment = 1 - ((Math.abs(novelty - request.novelty) + Math.abs(depth - request.depth)) / 200);
    const preferenceScore = Math.max(0, alignment * 10);
    const feedbackPenalty = overlap(video.topics, dislikedTopics).length * 12
      + (repeatedChannels.has(video.channelId) ? 18 : 0)
      + (avoidLong && durationMinutes > 30 ? 12 : 0)
      + (request.antiClickbait ? video.clickbaitScore * 0.15 : 0);
    const match = Math.max(35, Math.min(99, Math.round(intentScore + topicScore + affinityScore + durationScore + preferenceScore - feedbackPenalty)));
    const sourceSignal = source === "subscribed" ? "From your subscriptions" : "New creator discovery";
    const affinitySignal = affinityRaw >= 40 ? "Strong liked-video fit" : "Taste profile match";
    const topicSignal = topicMatches[0] ? `Matches ${topicMatches[0]}` : `Fits ${request.intent}`;
    const reason = `${source === "subscribed" ? "A recent upload from a channel you follow" : "A relevant perspective beyond your subscriptions"}. ${affinitySignal}.`;
    return [{ candidate, match, reason, signals: [sourceSignal, affinitySignal, topicSignal], durationMinutes }];
  }).sort((left, right) => right.match - left.match);

  const pools = {
    subscribed: scored.filter((item) => item.candidate.source === VideoSource.SUBSCRIBED),
    new: scored.filter((item) => item.candidate.source === VideoSource.NEW)
  };
  const order: Array<"subscribed" | "new"> = request.source === "mixed"
    ? ["subscribed", "new", "subscribed"]
    : [request.source, request.source, request.source];
  const selected: typeof scored = [];
  let totalMinutes = 0;
  for (const desiredSource of order) {
    const sourcePool = pools[desiredSource];
    const fallback = request.source === "mixed" ? pools[desiredSource === "new" ? "subscribed" : "new"] : [];
    const options = [...sourcePool, ...fallback].sort((left, right) => {
      const penalty = (item: typeof left) => selected.reduce((sum, picked) => sum
        + (item.candidate.video.channelId === picked.candidate.video.channelId ? 18 : 0)
        + (overlap(item.candidate.video.topics, picked.candidate.video.topics).length ? 8 : 0), 0);
      return (right.match - penalty(right)) - (left.match - penalty(left));
    });
    const next = options.find((item) => !selected.some((picked) => picked.candidate.video.id === item.candidate.video.id) && totalMinutes + item.durationMinutes <= request.minutes);
    if (!next) continue;
    selected.push(next);
    totalMinutes += next.durationMinutes;
  }

  const session = await db.recommendationSession.create({
    data: {
      userId,
      request,
      totalMinutes,
      items: {
        create: selected.map((item, position) => ({
          videoId: item.candidate.video.id,
          position,
          score: item.match,
          source: item.candidate.source,
          reason: item.reason,
          signals: item.signals
        }))
      }
    }
  });

  return {
    mode: "live" as const,
    sessionId: session.id,
    totalMinutes,
    naturalEnd: true as const,
    items: selected.map((item) => serializeVideo(
      item.candidate.video,
      item.candidate.source === VideoSource.SUBSCRIBED ? "subscribed" : "new",
      item.match,
      item.reason,
      item.signals
    )),
    emptyReason: selected.length ? undefined : quotaLimited ? "quota_limited" : candidates.length ? "no_filter_matches" : "no_source_matches",
    quotaLimited
  };
}
