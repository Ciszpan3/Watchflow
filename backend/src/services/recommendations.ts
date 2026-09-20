import { createHash, randomUUID } from "node:crypto";
import { env } from "../config/env.js";
import { db } from "../db.js";
import { VideoSource } from "../generated/prisma/enums.js";
import type { Video, Channel, Prisma } from "../generated/prisma/client.js";
import { isRecommendationRequest, type RecommendationRequest, type ViewerProfileInput } from "../viewer/contracts.js";
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
      }, { timeout: env.youtubeRequestTimeoutMs });
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

type BuildSessionOptions = {
  chainId?: string;
  page?: number;
  excludedVideoIds?: Iterable<string>;
};

type ScoredCandidate = {
  candidate: Candidate;
  match: number;
  reason: string;
  signals: string[];
  durationMinutes: number;
};

function normalizeStoredRequest(value: Prisma.JsonValue): RecommendationRequest | null {
  if (isRecommendationRequest(value)) return value;
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const legacy = { ...value, timeLimitEnabled: true, recommendationMode: "session" };
  return isRecommendationRequest(legacy) ? legacy : null;
}

function sourceOrder(request: RecommendationRequest) {
  const count = request.recommendationMode === "single" ? 5 : 3;
  if (request.source !== "mixed") return Array.from({ length: count }, () => request.source as "subscribed" | "new");
  return Array.from({ length: count }, (_, index) => index % 2 === 0 ? "subscribed" as const : "new" as const);
}

function durationFit(duration: number, request: RecommendationRequest) {
  if (!request.timeLimitEnabled) return 0;
  if (request.recommendationMode === "single") {
    const tolerance = Math.max(5, Math.ceil(request.minutes * 0.2));
    const distance = Math.abs(duration - request.minutes);
    return distance <= tolerance ? 15 - (distance / tolerance) * 5 : Math.max(0, 10 - (distance - tolerance));
  }
  return Math.max(0, 15 - Math.max(0, duration - request.minutes) * 2);
}

function selectCandidates(scored: ScoredCandidate[], request: RecommendationRequest) {
  const pools = {
    subscribed: scored.filter((item) => item.candidate.source === VideoSource.SUBSCRIBED),
    new: scored.filter((item) => item.candidate.source === VideoSource.NEW)
  };
  const selected: ScoredCandidate[] = [];
  let totalMinutes = 0;

  for (const desiredSource of sourceOrder(request)) {
    const sourcePool = pools[desiredSource];
    const fallback = request.source === "mixed" ? pools[desiredSource === "new" ? "subscribed" : "new"] : [];
    const options = [...sourcePool, ...fallback].sort((left, right) => {
      const penalty = (item: ScoredCandidate) => selected.reduce((sum, picked) => sum
        + (item.candidate.video.channelId === picked.candidate.video.channelId ? 18 : 0)
        + (overlap(item.candidate.video.topics, picked.candidate.video.topics).length ? 8 : 0), 0);
      const singleDistance = (item: ScoredCandidate) => request.recommendationMode === "single" && request.timeLimitEnabled
        ? Math.abs(item.durationMinutes - request.minutes)
        : 0;
      return (singleDistance(left) - singleDistance(right)) || ((right.match - penalty(right)) - (left.match - penalty(left)));
    });
    const next = options.find((item) => {
      if (selected.some((picked) => picked.candidate.video.id === item.candidate.video.id)) return false;
      return request.recommendationMode === "single"
        || !request.timeLimitEnabled
        || totalMinutes + item.durationMinutes <= request.minutes;
    });
    if (!next) continue;
    selected.push(next);
    totalMinutes += next.durationMinutes;
  }
  return selected;
}

function sessionResponse(session: {
  id: string;
  chainId: string;
  page: number;
  request: Prisma.JsonValue;
  totalMinutes: number;
  items: Array<{
    score: number;
    source: VideoSource;
    reason: string;
    signals: string[];
    video: Video & { channel: Channel };
  }>;
}, hasMore: boolean, quotaLimited = false, emptyReason?: "quota_limited" | "no_filter_matches" | "no_source_matches", seenVideoIds?: string[]) {
  const request = normalizeStoredRequest(session.request);
  if (!request) throw new Error("Stored recommendation request is invalid.");
  return {
    mode: "live" as const,
    sessionId: session.id,
    chainId: session.chainId,
    totalMinutes: session.totalMinutes,
    naturalEnd: request.recommendationMode === "session",
    request,
    page: session.page,
    hasMore,
    recommendationMode: request.recommendationMode,
    seenVideoIds: seenVideoIds ?? session.items.map((item) => item.video.id),
    items: session.items.map((item) => serializeVideo(
      item.video,
      item.source === VideoSource.SUBSCRIBED ? "subscribed" : "new",
      item.score,
      item.reason,
      item.signals
    )),
    emptyReason,
    quotaLimited
  };
}

export async function buildLiveSession(userId: string, request: RecommendationRequest, options: BuildSessionOptions = {}) {
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
  const excludedVideoIds = new Set([
    ...feedbackRows.map((row) => row.videoId),
    ...(options.excludedVideoIds ?? [])
  ]);
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
    const durationScore = durationFit(durationMinutes, request);
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

  const selected = selectCandidates(scored, request);
  const totalMinutes = selected.reduce((sum, item) => sum + item.durationMinutes, 0);
  const hasMore = scored.some((item) => !selected.some((picked) => picked.candidate.video.id === item.candidate.video.id));
  const chainId = options.chainId ?? randomUUID();
  const page = options.page ?? 1;

  const session = await db.recommendationSession.create({
    data: {
      userId,
      chainId,
      page,
      hasMore,
      request: request as Prisma.InputJsonValue,
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

  return sessionResponse({
    ...session,
    items: selected.map((item) => ({
      score: item.match,
      source: item.candidate.source,
      reason: item.reason,
      signals: item.signals,
      video: item.candidate.video
    }))
  }, hasMore, quotaLimited,
  selected.length ? undefined : quotaLimited ? "quota_limited" : candidates.length ? "no_filter_matches" : "no_source_matches");
}

export async function getLatestLiveSession(userId: string) {
  const latest = await db.recommendationSession.findFirst({
    where: { userId },
    orderBy: { createdAt: "desc" },
    include: { items: { orderBy: { position: "asc" }, include: { video: { include: { channel: true } } } } }
  });
  if (!latest) return null;
  const seen = await db.recommendationItem.findMany({
    where: { session: { userId, chainId: latest.chainId } },
    select: { videoId: true }
  });
  return sessionResponse(latest, latest.hasMore, false, undefined, seen.map((item) => item.videoId));
}

export async function buildNextLiveSession(userId: string, sessionId: string) {
  const previous = await db.recommendationSession.findFirst({ where: { id: sessionId, userId } });
  const request = previous ? normalizeStoredRequest(previous.request) : null;
  if (!previous || !request) {
    const error = new Error("Recommendation session was not found.") as Error & { code: string };
    error.code = "session_not_found";
    throw error;
  }
  const seen = await db.recommendationItem.findMany({
    where: { session: { userId, chainId: previous.chainId } },
    select: { videoId: true }
  });
  return buildLiveSession(userId, request, {
    chainId: previous.chainId,
    page: previous.page + 1,
    excludedVideoIds: seen.map((item) => item.videoId)
  });
}
