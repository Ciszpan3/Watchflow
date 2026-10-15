import { createHash, randomUUID } from "node:crypto";
import { env } from "../config/env.js";
import { db } from "../db.js";
import { VideoSource } from "../generated/prisma/enums.js";
import type { Video, Channel, Prisma } from "../generated/prisma/client.js";
import { isRecommendationRequest, type RecommendationRequest, type ViewerProfileInput } from "../viewer/contracts.js";
import { serializeProfile } from "../viewer/profile.js";
import { classifyStoredVideoTopics, classifyTopicsFromText, topicSearchTerms } from "./classification.js";
import { upsertVideo, videoDetails, youtubeForUser } from "./youtubeLive.js";

type DiscoveryLane = {
  key: string;
  label: string;
  query: string;
  source: "history" | "subscription" | "liked" | "interest" | "fallback";
  seedChannelTitle: string | null;
  preferredInterestKeys: string[];
  allowedInterestKeys: string[];
  anchorTerms: string[];
  order: "relevance" | "viewCount" | "date";
  durationVariant: 0 | 1;
  categoryId?: string;
};

type Candidate = {
  source: VideoSource;
  video: Video & { channel: Channel };
  discoveryLane?: DiscoveryLane;
  creatorAffinity?: CreatorAffinity;
  topicOverride?: boolean;
};

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

const freshnessCacheVersion = "personal-discovery-v27";
const recommendationAlgorithmVersion = "personal-discovery-v27";
const dayMs = 86_400_000;

export function subscriptionCandidateExpiration(now = new Date()) {
  return new Date(now.getTime() + env.subscriptionCandidateDays * dayMs);
}

export function isPopularNewCreator(viewCount: bigint | null, likeCount: bigint | null = null) {
  const views = Number(viewCount ?? 0);
  const likes = Number(likeCount ?? 0);
  const minimumViews = Math.max(25_000, env.minimumNewCreatorViews);
  if (views < minimumViews) return false;
  if (!likes) return views >= 1_000_000;
  const likeRate = likes / views;
  if (views >= 1_000_000) return likeRate >= 0.003;
  if (views >= 100_000) return likes >= 1_000 && likeRate >= 0.0075;
  return likes >= 1_000 && likeRate >= 0.02;
}

export function isLowTrustDiscoveryTitle(title: string, channelTitle = "") {
  const hashtagCount = (title.match(/#[\p{L}\p{N}_-]+/gu) ?? []).length;
  const emojiCount = (title.match(/\p{Extended_Pictographic}/gu) ?? []).length;
  const hypeCount = (title.match(/\b(?:viral|trending|fyp|shocking|insane|craziest|wild|must watch|surprise ending|sigma rizz)\b/giu) ?? []).length;
  return /\b(skibidi|slow english|good boy vs bad boy|ai generated|sigma rizz|surprise ending)\b|\bepisode\s*\d+\b|\b(?:minecraft|roblox)\s+animation\b/iu.test(title)
    || /(?:^|\W)(?:kids?|toons?)(?:$|\W)/iu.test(channelTitle)
    || hashtagCount >= 3
    || (emojiCount >= 3 && hypeCount >= 1)
    || hypeCount >= 3;
}

const intentSearchTerms: Record<RecommendationRequest["intent"], string[]> = {
  learn: ["explained", "tutorial", "learn"],
  relax: ["calm", "peaceful", "slow"],
  inspire: ["ideas", "inspiration", "creative"],
  company: ["podcast", "conversation", "interview"],
  solve: ["how to", "guide", "fix"],
  entertain: ["funny", "entertaining", "challenge"]
};

function ageCutoff(maxAgeMonths: RecommendationRequest["maxAgeMonths"], now = new Date()) {
  if (maxAgeMonths === null) return null;
  const cutoff = new Date(now);
  cutoff.setUTCMonth(cutoff.getUTCMonth() - maxAgeMonths);
  return cutoff;
}

export function searchCacheKey(query: string, language: string, format: string | undefined, maxAgeMonths: RecommendationRequest["maxAgeMonths"] = 12, categoryId?: string, videoDuration?: string, order = "relevance") {
  return createHash("sha256").update(`${freshnessCacheVersion}|${maxAgeMonths ?? "any"}|${query}|${language}|${format ?? "any"}|${categoryId ?? "any"}|${videoDuration ?? "any"}|${order}`).digest("hex");
}

export function youtubeSearchParameters(query: string, language: string, maxAgeMonths: RecommendationRequest["maxAgeMonths"] = 12, now = new Date(), categoryId?: string, videoDuration?: "short" | "medium" | "long", order: "relevance" | "viewCount" | "date" = "relevance") {
  const cutoff = ageCutoff(maxAgeMonths, now);
  return {
    part: ["snippet"] as "snippet"[],
    q: query,
    type: ["video"] as "video"[],
    maxResults: 50,
    order,
    relevanceLanguage: language,
    safeSearch: "moderate" as const,
    videoEmbeddable: "true" as const,
    ...(categoryId ? { videoCategoryId: categoryId } : {}),
    ...(videoDuration ? { videoDuration } : {}),
    ...(cutoff ? { publishedAfter: cutoff.toISOString() } : {})
  };
}

export function searchDurationForFormats(formats: RecommendationRequest["formats"], variant: number) {
  if (formats.length !== 1) return undefined;
  if (formats[0] === "short") return "short" as const;
  if (formats[0] === "podcast") return "long" as const;
  if (formats[0] === "standard") return variant === 0 ? "medium" as const : "long" as const;
  return undefined;
}

export function recommendationSearchOrder(_sortBy: RecommendationRequest["sortBy"], fallback: DiscoveryLane["order"]) {
  // YouTube's date order fills the first page with uploads that are too new to
  // have reliable quality signals. Build the same trusted pool for both modes;
  // Newest is applied deterministically after filtering and scoring.
  return fallback;
}

export type WatchHistorySignal = { videoId?: string | null; title: string; channelTitle: string | null; topics: string[]; watchedAt?: Date };
type DiscoveryTasteSignal = WatchHistorySignal & {
  origin: "history" | "subscription" | "liked";
  metadataText?: string;
  interestText?: string;
};

function discoveryMetadata(video: Pick<Video, "description" | "tags">) {
  const description = (video.description ?? "").replace(/https?:\/\/\S+/giu, " ").slice(0, 500);
  const hashtags = (video.description ?? "").match(/#[\p{L}\p{N}_-]+/gu) ?? [];
  return `${video.tags.join(" ")} ${description} ${hashtags.join(" ")}`.trim();
}

async function searchNewVideos(
  userId: string,
  request: RecommendationRequest,
  profile: ViewerProfileInput,
  historyRows: WatchHistorySignal[],
  knownHistoryVideos: CreatorCorpusVideo[] = []
) {
  const topics = (request.topics.length ? request.topics : [...profile.interests, ...profile.customTopics]).slice(0, 2);
  const languages = request.languages.slice(0, 2);
  const subscriptions = await db.subscription.findMany({ where: { userId }, include: { channel: true } });
  const subscribedChannels = new Set(subscriptions.map((item) => item.channelId));
  const subscribedTitles = new Set(subscriptions.map((item) => creatorFamilyName(item.channel.title)));
  const [subscriptionCandidates, likedRows] = await Promise.all([
    db.userVideoCandidate.findMany({
      where: { userId, source: VideoSource.SUBSCRIBED, expiresAt: { gt: new Date() } },
      include: { video: { include: { channel: true } } }
    }),
    db.likedVideo.findMany({ where: { userId }, include: { video: { include: { channel: true } } } })
  ]);
  const historyCorpus = [
    ...knownHistoryVideos,
    ...subscriptionCandidates.map((row) => row.video),
    ...likedRows.map((row) => row.video)
  ];
  const enrichedHistoryRows = enrichWatchHistorySignals(historyRows, historyCorpus);
  const tasteSignals: DiscoveryTasteSignal[] = [
    ...(profile.useWatchHistory ? enrichedHistoryRows.map((row) => ({ ...row, origin: "history" as const })) : []),
    ...subscriptionCandidates.map((row) => ({
      title: row.video.title,
      channelTitle: row.video.channel.title,
      topics: row.video.topics,
      watchedAt: row.discoveredAt,
      origin: "subscription" as const,
      metadataText: discoveryMetadata(row.video),
      interestText: row.video.tags.join(" ")
    })),
    ...(profile.useLikedVideos ? likedRows.map((row) => ({
      title: row.video.title,
      channelTitle: row.video.channel.title,
      topics: row.video.topics,
      watchedAt: row.importedAt,
      origin: "liked" as const,
      metadataText: discoveryMetadata(row.video),
      interestText: row.video.tags.join(" ")
    })) : [])
  ];
  const lanes = buildDiscoveryLanes(tasteSignals, topics, request.intent, subscribedTitles);
  let quotaLimited = false;
  const candidateVideoIds = new Set<string>();
  const lanesByVideoId = new Map<string, DiscoveryLane[]>();

  async function saveSearchCandidates(videoIds: string[], lane: DiscoveryLane) {
    if (!videoIds.length) return;
    const videos = await db.video.findMany({
      where: { id: { in: videoIds } },
      select: { id: true, channelId: true, title: true, description: true, tags: true, channel: { select: { title: true } } }
    });
    const newExpiresAt = new Date(Date.now() + env.searchCacheHours * 60 * 60 * 1000);
    const subscribedExpiresAt = subscriptionCandidateExpiration();
    for (const video of videos) {
      const subscribed = subscribedChannels.has(video.channelId);
      const seedFamily = lane.seedChannelTitle ? creatorFamilyName(lane.seedChannelTitle) : null;
      if (!subscribed && seedFamily && creatorFamilyName(video.channel.title) === seedFamily) continue;
      if (subscribed) {
        await db.userVideoCandidate.deleteMany({ where: { userId, videoId: video.id, source: VideoSource.NEW } });
      }
      await db.userVideoCandidate.upsert({
        where: { userId_videoId_source: { userId, videoId: video.id, source: subscribed ? VideoSource.SUBSCRIBED : VideoSource.NEW } },
        update: { discoveredAt: new Date(), expiresAt: subscribed ? subscribedExpiresAt : newExpiresAt },
        create: { userId, videoId: video.id, source: subscribed ? VideoSource.SUBSCRIBED : VideoSource.NEW, expiresAt: subscribed ? subscribedExpiresAt : newExpiresAt }
      });
      if (!subscribed) {
        candidateVideoIds.add(video.id);
        const videoLanes = lanesByVideoId.get(video.id) ?? [];
        if (!videoLanes.some((item) => item.key === lane.key)) videoLanes.push(lane);
        lanesByVideoId.set(video.id, videoLanes);
      }
    }
  }

  for (const [index, lane] of lanes.entries()) {
    const language = languages[index % languages.length] ?? "en";
    const query = lane.query;
    const videoDuration = searchDurationForFormats(request.formats, lane.durationVariant ?? index);
    const order = recommendationSearchOrder(request.sortBy, lane.order);
    const categoryId = lane.categoryId;
    const key = searchCacheKey(query, language, request.formats.length === 1 ? request.formats[0] : undefined, request.maxAgeMonths, categoryId, videoDuration, order);
    const cached = await db.searchCache.findUnique({ where: { cacheKey: key } });
    let ids = cached && cached.expiresAt > new Date() ? cached.videoIds : [];
    if (!ids.length) {
      if (!(await reserveSearchCall())) {
        quotaLimited = true;
        continue;
      }
      const youtube = await youtubeForUser(userId);
      const parameters = youtubeSearchParameters(query, language, request.maxAgeMonths, new Date(), categoryId, videoDuration, order);
      const response = await youtube.search.list(parameters, { timeout: env.youtubeRequestTimeoutMs });
      ids = (response.data.items ?? []).map((item) => item.id?.videoId).filter((id): id is string => Boolean(id));
      const details = await videoDetails(youtube, ids);
      for (const item of details) {
        await upsertVideo(item);
      }
      await db.searchCache.upsert({
        where: { cacheKey: key },
        update: { query, language, format: request.formats.length === 1 ? request.formats[0] : null, videoIds: ids, expiresAt: new Date(Date.now() + env.searchCacheHours * 60 * 60 * 1000) },
        create: { cacheKey: key, query, language, format: request.formats.length === 1 ? request.formats[0] : null, videoIds: ids, expiresAt: new Date(Date.now() + env.searchCacheHours * 60 * 60 * 1000) }
      });
    }
    await saveSearchCandidates(ids, lane);
  }

  if (quotaLimited && candidateVideoIds.size < request.resultCount) {
    const reusableCandidates = await db.userVideoCandidate.findMany({
      where: { userId, source: VideoSource.NEW, expiresAt: { gt: new Date() } },
      include: { video: { include: { channel: true } } }
    });
    for (const candidate of reusableCandidates) {
      if (candidateVideoIds.has(candidate.videoId)) continue;
      const text = `${candidate.video.title} ${candidate.video.description ?? ""} ${candidate.video.tags.join(" ")} ${candidate.video.channel.title}`;
      const decisiveText = `${candidate.video.title} ${candidate.video.tags.join(" ")}`;
      const lane = lanes.find((item) => !topics.includes("gaming")
        || !isPersonalDiscoveryLane(item)
        || personalizedDiscoveryEvidence(item, text, decisiveText).matched);
      if (!lane) continue;
      candidateVideoIds.add(candidate.videoId);
      lanesByVideoId.set(candidate.videoId, [lane]);
    }
  }
  return { quotaLimited, candidateVideoIds, lanesByVideoId, lanes };
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

export function fitTier(score: number) {
  return score >= 75 ? "excellent" as const : score >= 60 ? "strong" as const : score >= 45 ? "good" as const : "exploratory" as const;
}

export function serializeVideo(video: Video & { channel: Channel }, source: "subscribed" | "new", score = 0, reason = "Saved from a previous session.", signals: string[] = []) {
  const topics = [...new Set([...video.topics, ...classifyTopicsFromText(`${video.channel.title} ${video.channel.description ?? ""}`)])];
  return {
    id: video.id,
    title: video.title,
    channel: video.channel.title,
    image: video.thumbnailUrl ?? "",
    duration: Math.max(1, Math.ceil(video.durationSeconds / 60)),
    views: formatViews(video.viewCount),
    published: relativeDate(video.publishedAt),
    publishedAt: video.publishedAt?.toISOString() ?? null,
    intents: video.intents,
    source,
    channelSubscribed: source === "subscribed",
    topics,
    language: video.language === "pl" ? "pl" : "en",
    format: video.format,
    likedAffinity: 0,
    baseReason: reason,
    signals,
    fit: fitTier(score),
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
  frequentCreator: boolean;
};

export function freshnessForVideo(publishedAt: Date | null, maxAgeMonths: RecommendationRequest["maxAgeMonths"] = 12, now = new Date()) {
  if (!publishedAt) return { allowed: false, penalty: 0, signal: "Publication date unavailable" };
  const ageDays = Math.max(0, Math.floor((now.getTime() - publishedAt.getTime()) / dayMs));
  const cutoff = ageCutoff(maxAgeMonths, now);
  if (cutoff && publishedAt < cutoff) return { allowed: false, penalty: 0, signal: "Outside your selected age range" };
  const penalty = ageDays <= 30 ? 0 : ageDays <= 183 ? 2 : ageDays <= 365 ? 5 : ageDays <= 730 ? 10 : 18;
  const signal = ageDays <= 30 ? "Published this month"
    : ageDays <= 183 ? "Published recently"
      : ageDays <= 365 ? "Published this year"
        : ageDays <= 730 ? "Published within 2 years" : "Older video allowed by your filter";
  return { allowed: true, penalty, signal };
}

export function feedbackDecay(updatedAt: Date, now = new Date()) {
  const age = Math.max(0, now.getTime() - updatedAt.getTime());
  return Math.max(0, 1 - age / (30 * dayMs));
}

type FeedbackSignal = {
  reason: "ALREADY_WATCHED" | "NOT_FOR_ME" | "NOT_INTERESTED" | "TOO_LONG" | "TOO_OFTEN";
  targetTopics: string[];
  updatedAt: Date;
  video: Pick<Video, "channelId" | "durationSeconds" | "topics">;
};

export function feedbackPenaltyForVideo(
  video: Pick<Video, "channelId" | "durationSeconds" | "topics">,
  effectiveVideoTopics: string[],
  feedbackRows: FeedbackSignal[],
  now = new Date()
) {
  let topicPenalty = 0;
  let channelPenalty = 0;
  let durationPenalty = 0;
  const durationMinutes = Math.max(1, Math.ceil(video.durationSeconds / 60));
  for (const feedback of feedbackRows) {
    const decay = feedbackDecay(feedback.updatedAt, now);
    if (decay <= 0) continue;
    if (feedback.reason === "NOT_INTERESTED") {
      const targetTopics = feedback.targetTopics.length ? feedback.targetTopics : feedback.video.topics;
      if (overlap(effectiveVideoTopics, targetTopics).length) topicPenalty += 18 * decay;
    }
    if (feedback.reason === "TOO_OFTEN" && feedback.video.channelId === video.channelId) {
      channelPenalty += 22 * decay;
    }
    if (feedback.reason === "TOO_LONG") {
      const rejectedMinutes = Math.max(1, Math.ceil(feedback.video.durationSeconds / 60));
      const lowerBound = Math.max(5, rejectedMinutes * 0.75);
      const upperBound = rejectedMinutes * 1.35;
      if (durationMinutes >= lowerBound && durationMinutes <= upperBound) {
        const similarity = 1 - Math.min(1, Math.abs(durationMinutes - rejectedMinutes) / Math.max(5, rejectedMinutes * 0.35));
        durationPenalty += 18 * decay * Math.max(0.35, similarity);
      }
    }
  }
  return Math.min(28, topicPenalty) + Math.min(24, channelPenalty) + Math.min(20, durationPenalty);
}

export function freshnessReason(source: "subscribed" | "new", signal: string) {
  const origin = source === "new" ? "A perspective beyond your subscriptions" : "A video from a channel you follow";
  return `${origin}. ${signal}`;
}

function normalizeStoredRequest(value: Prisma.JsonValue): RecommendationRequest | null {
  if (isRecommendationRequest(value)) return normalizeRecommendationRequest(value);
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const legacyMode = "recommendationMode" in value && value.recommendationMode === "single" ? "single" : "session";
  const legacy = {
    ...value,
    timeLimitEnabled: "timeLimitEnabled" in value ? value.timeLimitEnabled : true,
    recommendationMode: legacyMode,
    sortBy: "sortBy" in value ? value.sortBy : "best_match",
    resultCount: "resultCount" in value ? value.resultCount : legacyMode === "single" ? 5 : 3,
    maxAgeMonths: "maxAgeMonths" in value ? value.maxAgeMonths : 12
  };
  return isRecommendationRequest(legacy) ? normalizeRecommendationRequest(legacy) : null;
}

export function normalizeRecommendationRequest(request: RecommendationRequest): RecommendationRequest {
  return request.sortBy === "newest" && request.maxAgeMonths !== 1
    ? { ...request, maxAgeMonths: 1 }
    : request;
}

export function normalizeSessionTopics(topics: string[]) {
  const selected = topics.at(-1)?.trim();
  return selected ? [selected] : [];
}

function storedAlgorithmVersion(value: Prisma.JsonValue) {
  return value && typeof value === "object" && !Array.isArray(value) && "algorithmVersion" in value
    ? value.algorithmVersion
    : null;
}

function sourceOrder(request: RecommendationRequest) {
  const count = request.resultCount;
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

function effectiveTopics(video: Video & { channel: Channel }) {
  return classifyStoredVideoTopics({
    ...video,
    channelTitle: video.channel.title,
    channelDescription: video.channel.description
  });
}

const strongTopicEvidence: Record<string, string[]> = {
  technology: [
    "artificial intelligence", "ai", "software", "coding", "programming", "computer", "smartphone", "iphone", "android",
    "chip", "gpu", "robotics", "neuralink", "cybersecurity", "technology", "tech industry", "developer"
  ],
  science: [
    "science", "physics", "chemistry", "biology", "astronomy", "telescope", "nasa", "climate", "glacier", "periodic table",
    "scientist", "research", "ncert", "weather", "el nino"
  ],
  history: [
    "history", "historical", "ancient", "medieval", "archaeology", "civilization", "empire", "dynasty", "world war",
    "cold war", "history documentary", "historia", "historyczny", "starożytny", "średniowiecze"
  ],
  cooking: [
    "cooking", "recipe", "baking", "chef", "meal prep", "cuisine", "how to cook", "kitchen recipe", "gotowanie",
    "przepis", "pieczenie", "kuchnia"
  ],
  design: [
    "graphic design", "interior design", "industrial design", "web design", "ux design", "ui design", "architecture",
    "typography", "branding", "projektowanie", "architektura", "design process"
  ],
  finance: [
    "personal finance", "finance", "investing", "investment", "stock market", "stocks", "etf", "budgeting", "financial freedom",
    "retirement", "portfolio", "finanse", "inwestowanie", "giełda", "budżet"
  ],
  health: [
    "health", "fitness", "workout", "nutrition", "wellness", "bodybuilding", "weight loss", "fat loss", "mobility",
    "exercise", "strength training", "mental health", "zdrowie", "trening", "siłownia", "odchudzanie", "dietetyka"
  ],
  gaming: [
    "gaming", "gameplay", "video game", "video games", "walkthrough", "playthrough", "speedrun", "multiplayer", "esports",
    "playstation", "xbox", "nintendo", "steam", "gra komputerowa", "gry komputerowe"
  ],
  music: [
    "music", "music video", "official audio", "song", "album", "concert", "live performance", "piano", "guitar", "muzyka",
    "piosenka", "koncert"
  ],
  culture: [
    "culture", "society", "philosophy", "literature", "cinema", "cultural history", "art history", "book review", "kultura",
    "społeczeństwo", "filozofia", "literatura"
  ],
  travel: [
    "travel", "travelling", "traveling", "tourism", "tourist", "travel vlog", "travel guide", "solo travel", "backpacking",
    "road trip", "city break", "itinerary", "destination", "vacation", "places to visit", "things to do", "48 hours in",
    "days in", "biggest city", "podróż", "podróże", "turystyka", "wakacje", "zwiedzanie"
  ],
  diy: [
    "diy", "do it yourself", "woodworking", "home repair", "restoration", "craft tutorial", "how to build", "how to make",
    "zrób to sam", "renowacja", "stolarstwo", "naprawa"
  ]
};

const primaryTopicCategories: Record<string, string[]> = {
  gaming: ["20"],
  music: ["10"],
  travel: ["19"],
  technology: ["28"],
  science: ["28"]
};

const blockedTopicCategories: Record<string, string[]> = {
  technology: ["10", "17", "20"],
  science: ["10", "17", "20"],
  history: ["10", "17", "20"],
  cooking: ["10", "17", "20", "25"],
  design: ["17", "20"],
  finance: ["10", "17", "20"],
  health: ["10", "20"],
  gaming: ["10", "17", "19", "25", "26", "27", "28"],
  music: ["17", "19", "20", "25", "27", "28"],
  culture: ["17", "20"],
  travel: ["10", "17", "20", "25", "28"],
  diy: ["10", "17", "20", "25"]
};

const sportsTerms = ["football", "soccer", "nfl", "nba", "premier league", "full game", "match highlights", "goals", "touchdown"];
const topicConflictTerms: Record<string, string[]> = {
  travel: [
    ...sportsTerms,
    "gameplay", "roblox", "minecraft", "video game", "esports", "songs playlist", "song playlist", "music playlist",
    "official audio", "album mix", "travel compatibility", "travel match", "travel quiz"
  ],
  finance: ["gameplay", "gta online", "video game", "football", "soccer", "full game"],
  health: ["gameplay", "video game", "full game", "match highlights"],
  cooking: ["gameplay", "video game", "full game", "match highlights"],
  technology: ["gameplay", "video game", "full game", "match highlights"],
  science: ["gameplay", "video game", "full game", "match highlights"],
  history: ["gameplay", "video game", "full game", "match highlights"],
  design: ["gameplay", "video game", "full game", "match highlights"],
  diy: ["gameplay", "video game", "full game", "match highlights"]
};

export function topicCategoryIdForSearch(topic: string) {
  return primaryTopicCategories[topic]?.[0];
}

export function topicCategoryMismatch(video: Pick<Video, "categoryId">, requestedTopics: string[]) {
  if (requestedTopics.length !== 1) return false;
  const topic = requestedTopics[0];
  if (topic === "gaming") return video.categoryId !== "20";
  if (!video.categoryId) return false;
  return blockedTopicCategories[topic]?.includes(video.categoryId) ?? false;
}

export function hasStrongTopicEvidence(video: Pick<Video, "title" | "description" | "tags" | "categoryId"> & { channel: Pick<Channel, "title" | "description"> }, topic: string) {
  const evidenceTerms = strongTopicEvidence[topic];
  if (!evidenceTerms) return false;
  if (topicCategoryMismatch(video, [topic])) return false;

  const title = video.title.toLowerCase();
  const tags = video.tags.join(" ").toLowerCase();
  const description = (video.description ?? "").toLowerCase();
  const decisiveMetadata = `${title} ${tags}`;
  if ((topicConflictTerms[topic] ?? []).some((term) => containsPhrase(decisiveMetadata, term))) return false;
  const titleHits = evidenceTerms.filter((term) => containsPhrase(title, term)).length;
  const tagHits = evidenceTerms.filter((term) => containsPhrase(tags, term)).length;
  const descriptionHits = evidenceTerms.filter((term) => containsPhrase(description, term)).length;
  const categoryIsPrimary = primaryTopicCategories[topic]?.includes(video.categoryId ?? "") ?? false;

  if (topic === "health" && video.categoryId === "17") {
    const competitiveSports = sportsTerms.some((term) => containsPhrase(`${title} ${tags}`, term));
    if (competitiveSports && titleHits === 0) return false;
  }
  if (["gaming", "music", "travel"].includes(topic) && categoryIsPrimary) return true;
  if (categoryIsPrimary && titleHits + tagHits >= 1) return true;
  if (titleHits >= 1) return true;
  return tagHits >= 2 && descriptionHits >= 1;
}

export function hasExcludedTopicConflict(
  video: Pick<Video, "categoryId">,
  topics: string[],
  excludedTopics: string[],
  requestedTopics: string[]
) {
  const conflicts = overlap(topics, excludedTopics);
  if (!conflicts.length) return false;
  const primaryTopic = video.categoryId === "20" ? "gaming"
    : video.categoryId === "10" ? "music"
      : video.categoryId === "19" ? "travel"
        : null;
  if (primaryTopic && excludedTopics.includes(primaryTopic)) return true;
  if (conflicts.some((topic) => requestedTopics.includes(topic))) return true;
  return !requestedTopics.length || !overlap(topics, requestedTopics).length;
}

function popularityScore(video: Video, source: "subscribed" | "new") {
  if (source !== "new") return 0;
  const views = Number(video.viewCount ?? 0);
  const likes = Number(video.likeCount ?? 0);
  const viewScore = Math.min(18, Math.max(0, (Math.log10(Math.max(views, 1)) - 4) * 3));
  const likeRate = views > 0 ? Math.min(4, (likes / views) * 100) : 0;
  return viewScore + likeRate;
}

const historyStopWords = new Set([
  "about", "after", "before", "could", "from", "have", "into", "just", "that", "their", "there", "this", "what", "when", "with",
  "your", "youtube", "watch", "watched", "video", "film", "the", "and", "for", "how", "one", "you", "are", "was", "were", "they", "them",
  "obejrzano", "oglądano", "gaming", "game", "games", "gameplay", "official", "episode", "part", "live", "shorts",
  "best", "ever", "most", "played", "good", "last", "made", "year", "will", "still", "finally", "more", "new"
]);

function titleWords(value: string) {
  return new Set(value.toLowerCase().split(/[^\p{L}\p{N}]+/u).filter((word) => word.length >= 4 && !historyStopWords.has(word)));
}

const gamingInterests = [
  { key: "minecraft", label: "Minecraft", query: "minecraft", aliases: ["minecraft"] },
  { key: "counter-strike", label: "Counter-Strike", query: "cs2 counter strike", aliases: ["cs2", "csgo", "counterstrike", "counter strike"] },
  { key: "brawl-stars", label: "Brawl Stars", query: "brawl stars", aliases: ["brawlstars", "brawl stars", "brawler", "brawl pass", "star drop"] },
  { key: "clash-royale", label: "Clash Royale", query: "clash royale", aliases: ["clashroyale", "clash royale", "ebarbs", "x-bow", "xbow", "electro giant", "hog rider", "infinite elixir"] },
  { key: "clash-of-clans", label: "Clash of Clans", query: "clash of clans", aliases: ["clashofclans", "clash of clans"] },
  { key: "rocket-league", label: "Rocket League", query: "rocket league", aliases: ["rocketleague", "rocket league"] },
  { key: "fortnite", label: "Fortnite", query: "fortnite", aliases: ["fortnite", "fncs"] },
  { key: "roblox", label: "Roblox", query: "roblox", aliases: ["roblox"] },
  { key: "bloons", label: "Bloons TD", query: "bloons td btd6", aliases: ["btd6", "bloons", "bloons td"] },
  { key: "valorant", label: "Valorant", query: "valorant", aliases: ["valorant"] },
  { key: "gta", label: "GTA", query: "gta online", aliases: ["gta", "grand theft auto"] },
  { key: "chess", label: "Chess", query: "chess", aliases: ["chess", "checkmate"] },
  { key: "geoguessr", label: "GeoGuessr", query: "geoguessr", aliases: ["geoguessr"] }
] as const;

const gamingStyleTerms = new Set([
  "challenge", "competitive", "coop", "friends", "funny", "horror", "modded", "multiplayer", "party", "ranked",
  "sandbox", "simulation", "simulator", "strategy", "survival", "variety"
]);

function containsPhrase(value: string, phrase: string) {
  const escaped = phrase.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`(?:^|[^\\p{L}\\p{N}])${escaped}(?:$|[^\\p{L}\\p{N}])`, "iu").test(value);
}

export function gamingInterestKeys(value: string) {
  const normalized = value.toLowerCase();
  return gamingInterests.filter((interest) => interest.aliases.some((alias) => containsPhrase(normalized, alias))).map((interest) => interest.key);
}

export function personalizedDiscoveryEvidence(
  lane: Pick<DiscoveryLane, "preferredInterestKeys" | "allowedInterestKeys" | "anchorTerms">,
  value: string,
  decisiveValue = value
) {
  const normalized = value.toLowerCase();
  const candidateInterests = gamingInterestKeys(decisiveValue.toLowerCase());
  const matchingInterests = candidateInterests.filter((key) => lane.preferredInterestKeys.includes(key));
  const matchingAnchors = lane.anchorTerms.filter((term) => containsPhrase(normalized, term));
  const requiredAnchorMatches = Math.min(2, lane.anchorTerms.length);
  const hasUnsupportedSpecificInterest = candidateInterests.length > 0
    && !candidateInterests.some((key) => lane.allowedInterestKeys.includes(key));
  return {
    matchingInterests,
    matchingAnchors,
    hasUnsupportedSpecificInterest,
    matched: !hasUnsupportedSpecificInterest
      && (matchingInterests.length > 0 || (requiredAnchorMatches > 0 && matchingAnchors.length >= requiredAnchorMatches))
  };
}

function isPersonalDiscoveryLane(lane: DiscoveryLane) {
  return lane.source === "history" || lane.source === "subscription" || lane.source === "liked";
}

export function discoveryPreferenceScore(
  source: DiscoveryLane["source"],
  preferredInterestKeys: string[],
  anchorTerms: string[],
  value: string
) {
  const sourceScore = source === "liked" ? 20 : source === "history" ? 18 : source === "subscription" ? 10 : 4;
  const matchingInterests = gamingInterestKeys(value).filter((key) => preferredInterestKeys.includes(key)).length;
  const anchorMatch = anchorTerms.some((term) => containsPhrase(value.toLowerCase(), term));
  return sourceScore + Math.min(16, matchingInterests * 8) + (anchorMatch ? 5 : 0);
}

function gamingInterest(key: string) {
  return gamingInterests.find((interest) => interest.key === key);
}

export function normalizeCreatorName(value: string) {
  return value.toLowerCase().normalize("NFKD").replace(/[^\p{L}\p{N}]+/gu, "").trim();
}

export function creatorFamilyName(value: string) {
  return normalizeCreatorName(value)
    .replace(/^(?:more|the)/u, "")
    .replace(/(?:plus|extra|clips|shorts|gaming|games|tv|pops|high|low)$/u, "");
}

export type CreatorCorpusVideo = Pick<Video, "id" | "channelId" | "title" | "description" | "tags" | "categoryId" | "topics"> & {
  channel: Pick<Channel, "title">;
};

export function enrichWatchHistorySignals(rows: WatchHistorySignal[], corpus: CreatorCorpusVideo[]) {
  const directVideosById = new Map<string, CreatorCorpusVideo>();
  const creatorTopics = new Map<string, { total: number; counts: Map<string, number> }>();

  for (const video of corpus) {
    directVideosById.set(video.id, video);
    const family = creatorFamilyName(video.channel.title);
    if (!family) continue;
    const summary = creatorTopics.get(family) ?? { total: 0, counts: new Map<string, number>() };
    summary.total += 1;
    for (const topic of classifyStoredVideoTopics({
      ...video,
      channelTitle: video.channel.title
    })) summary.counts.set(topic, (summary.counts.get(topic) ?? 0) + 1);
    creatorTopics.set(family, summary);
  }

  return rows.map((row) => {
    const family = row.channelTitle ? creatorFamilyName(row.channelTitle) : "";
    const direct = row.videoId ? directVideosById.get(row.videoId) : undefined;
    const knownVideo = direct;
    const familySummary = family ? creatorTopics.get(family) : undefined;
    const dominantCreatorTopics = familySummary
      ? [...familySummary.counts.entries()]
        .filter(([, count]) => count >= 2 && count / familySummary.total >= 0.35)
        .map(([topic]) => topic)
      : [];
    const inferred = classifyStoredVideoTopics({
      title: row.title,
      channelTitle: row.channelTitle,
      ...(knownVideo ? {
        description: knownVideo.description,
        tags: knownVideo.tags,
        categoryId: knownVideo.categoryId,
        topics: knownVideo.topics
      } : {})
    });
    return { ...row, topics: [...new Set([...row.topics, ...inferred, ...dominantCreatorTopics])] };
  });
}

export type CreatorAffinity = {
  key: string;
  title: string;
  historyCount: number;
  uniqueHistoryCount: number;
  weightedHistory: number;
  score: number;
  frequent: boolean;
  gamingConfidence: number;
};

function historyRecencyWeight(watchedAt: Date | undefined, now: Date) {
  if (!watchedAt) return 0.35;
  const ageDays = Math.max(0, (now.getTime() - watchedAt.getTime()) / dayMs);
  return ageDays <= 90 ? 1 : ageDays <= 365 ? 0.65 : 0.35;
}

export type HistoryTasteProfile = {
  rowCount: number;
  creatorWeights: Map<string, { title: string; weight: number; uniqueCount: number }>;
  termWeights: Map<string, number>;
  topicWeights: Map<string, number>;
  maxCreatorWeight: number;
  maxTermWeight: number;
};

export function buildHistoryTasteProfile(rows: WatchHistorySignal[], now = new Date()): HistoryTasteProfile {
  const creatorWeights = new Map<string, { title: string; weight: number; identities: Set<string> }>();
  const termWeights = new Map<string, number>();
  const topicWeights = new Map<string, number>();
  const repeats = new Map<string, number>();

  for (const row of rows) {
    const family = row.channelTitle ? creatorFamilyName(row.channelTitle) : "";
    const identity = row.videoId ?? `${family}:${normalizeCreatorName(row.title)}`;
    const repeat = repeats.get(identity) ?? 0;
    repeats.set(identity, repeat + 1);
    if (repeat >= 3) continue;
    const repeatWeight = repeat === 0 ? 1 : repeat === 1 ? 0.35 : 0.15;
    const weight = historyRecencyWeight(row.watchedAt, now) * repeatWeight;
    if (family) {
      const creator = creatorWeights.get(family) ?? { title: row.channelTitle ?? family, weight: 0, identities: new Set<string>() };
      creator.weight += weight;
      creator.identities.add(identity);
      creatorWeights.set(family, creator);
    }
    const creatorWords = titleWords(row.channelTitle ?? "");
    for (const term of titleWords(row.title)) {
      if (!creatorWords.has(term)) termWeights.set(term, (termWeights.get(term) ?? 0) + weight);
    }
    for (const topic of row.topics) topicWeights.set(topic, (topicWeights.get(topic) ?? 0) + weight);
  }

  const publicCreators = new Map([...creatorWeights.entries()].map(([key, value]) => [key, {
    title: value.title,
    weight: value.weight,
    uniqueCount: value.identities.size
  }]));
  return {
    rowCount: rows.length,
    creatorWeights: publicCreators,
    termWeights,
    topicWeights,
    maxCreatorWeight: Math.max(0, ...[...publicCreators.values()].map((item) => item.weight)),
    maxTermWeight: Math.max(0, ...termWeights.values())
  };
}

const genericGamingEvidence = /\b(gameplay|gaming|ranked|tournament|boss|speedrun|walkthrough|playthrough|multiplayer|esports?|patch|clutch|console|xbox|playstation|steam)\b/iu;

function corpusText(video: CreatorCorpusVideo) {
  return `${video.title} ${video.description ?? ""} ${video.tags.join(" ")}`.toLowerCase();
}

function confirmedGamingTokens(videos: CreatorCorpusVideo[]) {
  const counts = new Map<string, number>();
  for (const video of videos) {
    if (video.categoryId !== "20" && !video.topics.includes("gaming")) continue;
    for (const token of titleWords(corpusText(video))) counts.set(token, (counts.get(token) ?? 0) + 1);
  }
  return [...counts.entries()]
    .filter(([token, count]) => token.length >= 5 && count >= 2)
    .sort((left, right) => right[1] - left[1])
    .slice(0, 120)
    .map(([token]) => token);
}

function hasLearnedGamingEvidence(video: CreatorCorpusVideo, learnedTokens: string[]) {
  if (video.categoryId === "20" || video.topics.includes("gaming")) return true;
  const text = corpusText(video);
  if (genericGamingEvidence.test(text)) return true;
  const tokens = [...titleWords(text)];
  return tokens.some((token) => learnedTokens.some((learned) => token === learned || token.includes(learned) || learned.includes(token)));
}

export function buildCreatorAffinities(
  historyRows: WatchHistorySignal[],
  subscribedVideos: CreatorCorpusVideo[],
  likedChannelIds = new Set<string>(),
  openedChannelIds = new Set<string>(),
  savedChannelIds = new Set<string>(),
  now = new Date()
) {
  const historyRowsByCreator = new Map<string, WatchHistorySignal[]>();
  const history = new Map<string, {
    title: string;
    count: number;
    weighted: number;
    identities: Set<string>;
    identityCounts: Map<string, number>;
  }>();
  for (const row of historyRows) {
    if (!row.channelTitle) continue;
    const key = creatorFamilyName(row.channelTitle);
    if (!key) continue;
    const item = history.get(key) ?? { title: row.channelTitle, count: 0, weighted: 0, identities: new Set<string>(), identityCounts: new Map<string, number>() };
    const identity = row.videoId ?? normalizeCreatorName(row.title);
    const repeats = item.identityCounts.get(identity) ?? 0;
    item.count += 1;
    item.identities.add(identity);
    item.identityCounts.set(identity, repeats + 1);
    if (repeats < 3) item.weighted += historyRecencyWeight(row.watchedAt, now);
    history.set(key, item);
    const creatorRows = historyRowsByCreator.get(key) ?? [];
    creatorRows.push(row);
    historyRowsByCreator.set(key, creatorRows);
  }

  const videosByCreator = new Map<string, CreatorCorpusVideo[]>();
  for (const video of subscribedVideos) {
    const key = creatorFamilyName(video.channel.title);
    const values = videosByCreator.get(key) ?? [];
    values.push(video);
    videosByCreator.set(key, values);
  }
  const learnedTokens = confirmedGamingTokens(subscribedVideos);
  const rankedHistory = [...history.entries()].sort((left, right) => right[1].weighted - left[1].weighted);
  const maximumWeight = rankedHistory[0]?.[1].weighted ?? 0;
  const frequentKeys = new Set(rankedHistory
    .filter(([, item]) => item.identities.size >= 5 && item.weighted >= Math.max(5, maximumWeight * 0.2))
    .slice(0, 12)
    .map(([key]) => key));
  const channelSignals = new Map<string, { liked: boolean; opened: boolean; saved: boolean }>();
  for (const video of subscribedVideos) {
    const key = creatorFamilyName(video.channel.title);
    const signals = channelSignals.get(key) ?? { liked: false, opened: false, saved: false };
    signals.liked ||= likedChannelIds.has(video.channelId);
    signals.opened ||= openedChannelIds.has(video.channelId);
    signals.saved ||= savedChannelIds.has(video.channelId);
    channelSignals.set(key, signals);
  }

  const affinities = new Map<string, CreatorAffinity>();
  for (const [key, item] of history) {
    const videos = videosByCreator.get(key) ?? [];
    const creatorHistory = historyRowsByCreator.get(key) ?? [];
    const uniqueHistory = [...new Map(creatorHistory.map((row) => [row.videoId ?? normalizeCreatorName(row.title), row])).values()];
    const historyGamingEvidence = uniqueHistory.filter((row) => {
      if (row.topics.includes("gaming")) return true;
      const text = row.title.toLowerCase();
      if (genericGamingEvidence.test(text)) return true;
      const words = [...titleWords(text)];
      return words.some((token) => learnedTokens.some((learned) => token === learned || token.includes(learned) || learned.includes(token)));
    }).length;
    const corpusGamingEvidence = videos.filter((video) => hasLearnedGamingEvidence(video, learnedTokens)).length;
    const evidenceSampleSize = Math.min(videos.length, 20) + Math.min(uniqueHistory.length, 20);
    const gamingConfidence = evidenceSampleSize
      ? (Math.min(corpusGamingEvidence, 20) + Math.min(historyGamingEvidence, 20)) / evidenceSampleSize
      : 0;
    const signals = channelSignals.get(key) ?? { liked: false, opened: false, saved: false };
    const historyScore = maximumWeight ? Math.min(24, (item.weighted / maximumWeight) * 24) : 0;
    affinities.set(key, {
      key,
      title: item.title,
      historyCount: item.count,
      uniqueHistoryCount: item.identities.size,
      weightedHistory: item.weighted,
      score: historyScore + (signals.liked ? 5 : 0) + (signals.opened ? 3 : 0) + (signals.saved ? 4 : 0),
      frequent: frequentKeys.has(key),
      gamingConfidence: Math.min(1, gamingConfidence)
    });
  }
  return affinities;
}

export function controlledGamingOverride(video: CreatorCorpusVideo, affinity: CreatorAffinity | undefined) {
  return video.categoryId === "24"
    && Boolean(affinity?.frequent)
    && (affinity?.gamingConfidence ?? 0) >= 0.15;
}

type CreatorTaste = {
  key: string;
  title: string;
  historyCount: number;
  historyWeight: number;
  historyIdentities: Set<string>;
  subscriptionCount: number;
  likedCount: number;
  subscribed: boolean;
  interestScores: Map<string, number>;
  interestEvidence: Map<string, { history: number; liked: number; subscription: number }>;
  termScores: Map<string, number>;
};

function strongCreatorInterestKeys(creator: CreatorTaste) {
  return [...creator.interestScores.entries()]
    .filter(([key]) => {
      const evidence = creator.interestEvidence.get(key);
      if (!evidence) return false;
      const historyVideos = evidence.history / 4;
      const dominantHistoryPattern = historyVideos >= 6 && historyVideos >= creator.historyWeight * 0.3;
      return dominantHistoryPattern || evidence.liked >= 12;
    })
    .sort((left, right) => right[1] - left[1])
    .map(([key]) => key);
}

function strongCreatorAnchorTerms(creator: CreatorTaste, gaming: boolean) {
  return [...creator.termScores.entries()]
    .filter(([term, score]) => score >= 8 && (!gaming || gamingStyleTerms.has(term)))
    .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))
    .slice(0, 3)
    .map(([term]) => term);
}

function hasCreatorDiscoveryEvidence(creator: CreatorTaste, gaming: boolean) {
  return strongCreatorInterestKeys(creator).length > 0 || strongCreatorAnchorTerms(creator, gaming).length >= 2;
}

function creatorTasteScore(creator: CreatorTaste, globalInterestScores: Map<string, number>) {
  const affinity = Math.min(creator.historyWeight, 16) * 5
    + Math.min(creator.historyIdentities.size, 12) * 2
    + Math.min(creator.likedCount, 8) * 5
    + Math.min(creator.subscriptionCount, 8) * 2
    + (creator.subscribed ? 8 : 0);
  const interestAffinity = [...creator.interestScores.keys()].reduce((sum, key) => sum + Math.min(8, globalInterestScores.get(key) ?? 0), 0);
  return affinity + interestAffinity;
}

export function buildDiscoveryLanes(
  signals: DiscoveryTasteSignal[],
  requestedTopics: string[],
  intent: RecommendationRequest["intent"],
  subscribedTitles = new Set<string>()
) {
  const directlyRelevant = (signal: DiscoveryTasteSignal) => {
    if (!requestedTopics.length) return true;
    if (overlap(signal.topics, requestedTopics).length) return true;
    return requestedTopics.includes("gaming") && gamingInterestKeys(`${signal.title} ${signal.interestText ?? signal.metadataText ?? ""} ${signal.channelTitle ?? ""}`).length > 0;
  };
  const signalsByCreator = new Map<string, DiscoveryTasteSignal[]>();
  for (const signal of signals) {
    if (!signal.channelTitle) continue;
    const key = creatorFamilyName(signal.channelTitle);
    const creatorSignals = signalsByCreator.get(key) ?? [];
    creatorSignals.push(signal);
    signalsByCreator.set(key, creatorSignals);
  }
  const relevantCreatorKeys = new Set([...signalsByCreator.entries()].flatMap(([key, creatorSignals]) => {
    const directCount = creatorSignals.filter(directlyRelevant).length;
    return directCount >= 6 || (directCount >= 3 && directCount / creatorSignals.length >= 0.12) ? [key] : [];
  }));
  const relevantSignals = signals.filter((signal) => directlyRelevant(signal)
    || Boolean(signal.channelTitle && relevantCreatorKeys.has(creatorFamilyName(signal.channelTitle))));
  const creators = new Map<string, CreatorTaste>();
  const globalInterestScores = new Map<string, number>();
  const globalInterestEvidence = new Map<string, { historyIdentities: Set<string>; historyScore: number; liked: number }>();
  const historyRepeats = new Map<string, number>();

  for (const signal of relevantSignals) {
    const interestKeys = requestedTopics.includes("gaming") ? gamingInterestKeys(`${signal.title} ${signal.interestText ?? signal.metadataText ?? ""} ${signal.channelTitle ?? ""}`) : [];
    const creatorKey = signal.channelTitle ? creatorFamilyName(signal.channelTitle) : "";
    const historyIdentity = signal.origin === "history"
      ? `${creatorKey}:${signal.videoId ?? normalizeCreatorName(signal.title)}`
      : "";
    const repeat = historyIdentity ? historyRepeats.get(historyIdentity) ?? 0 : 0;
    if (historyIdentity) historyRepeats.set(historyIdentity, repeat + 1);
    const repeatWeight = repeat === 0 ? 1 : repeat === 1 ? 0.35 : repeat === 2 ? 0.15 : 0;
    const signalWeight = signal.origin === "liked" ? 6
      : signal.origin === "history" ? 4 * historyRecencyWeight(signal.watchedAt, new Date()) * repeatWeight
        : 0.25;
    if (signalWeight <= 0) continue;
    for (const key of new Set(interestKeys)) {
      globalInterestScores.set(key, (globalInterestScores.get(key) ?? 0) + signalWeight);
      const evidence = globalInterestEvidence.get(key) ?? { historyIdentities: new Set<string>(), historyScore: 0, liked: 0 };
      if (signal.origin === "history" && historyIdentity && !evidence.historyIdentities.has(historyIdentity)) {
        evidence.historyIdentities.add(historyIdentity);
        evidence.historyScore += historyRecencyWeight(signal.watchedAt, new Date());
      }
      if (signal.origin === "liked") evidence.liked += 1;
      globalInterestEvidence.set(key, evidence);
    }
    if (!signal.channelTitle) continue;
    const key = creatorKey;
    if (!key) continue;
    const creator = creators.get(key) ?? {
      key,
      title: signal.channelTitle,
      historyCount: 0,
      historyWeight: 0,
      historyIdentities: new Set<string>(),
      subscriptionCount: 0,
      likedCount: 0,
      subscribed: subscribedTitles.has(key),
      interestScores: new Map<string, number>(),
      interestEvidence: new Map<string, { history: number; liked: number; subscription: number }>(),
      termScores: new Map<string, number>()
    };
    if (signal.origin === "history") {
      creator.historyCount += 1;
      creator.historyWeight += signalWeight / 4;
      creator.historyIdentities.add(historyIdentity);
    }
    if (signal.origin === "subscription") creator.subscriptionCount += 1;
    if (signal.origin === "liked") creator.likedCount += 1;
    creator.subscribed ||= subscribedTitles.has(key);
    for (const interestKey of new Set(interestKeys)) {
      creator.interestScores.set(interestKey, (creator.interestScores.get(interestKey) ?? 0) + signalWeight);
      const evidence = creator.interestEvidence.get(interestKey) ?? { history: 0, liked: 0, subscription: 0 };
      evidence[signal.origin] += signalWeight;
      creator.interestEvidence.set(interestKey, evidence);
    }
    const creatorWords = titleWords(signal.channelTitle);
    for (const term of titleWords(signal.title)) {
      if (!creatorWords.has(term)) creator.termScores.set(term, (creator.termScores.get(term) ?? 0) + signalWeight);
    }
    creators.set(key, creator);
  }

  const rankedCreators = [...creators.values()].sort((left, right) =>
    creatorTasteScore(right, globalInterestScores) - creatorTasteScore(left, globalInterestScores)
      || left.title.localeCompare(right.title));
  const selectedCreators: Array<{ creator: CreatorTaste; source: DiscoveryLane["source"] }> = [];
  const coveredInterests = new Set<string>();
  const creatorAlreadySelected = (creator: CreatorTaste) => selectedCreators.some((item) => item.creator.key === creator.key
    || creatorFamilyName(item.creator.title) === creatorFamilyName(creator.title));

  const addCreator = (creator: CreatorTaste | undefined, source: DiscoveryLane["source"]) => {
    if (!creator || creatorAlreadySelected(creator)) return;
    selectedCreators.push({ creator, source });
    for (const key of creator.interestScores.keys()) coveredInterests.add(key);
  };

  const watchedCreators = rankedCreators
    .filter((creator) => creator.historyIdentities.size >= 2 && hasCreatorDiscoveryEvidence(creator, requestedTopics.includes("gaming")))
    .sort((left, right) => right.historyWeight - left.historyWeight
      || right.historyIdentities.size - left.historyIdentities.size
      || right.likedCount - left.likedCount
      || creatorTasteScore(right, globalInterestScores) - creatorTasteScore(left, globalInterestScores));
  while (selectedCreators.filter((item) => item.source === "history").length < 3) {
    const nextWatched = watchedCreators
      .filter((creator) => !creatorAlreadySelected(creator))
      .sort((left, right) => {
        const value = (creator: CreatorTaste) => creator.historyWeight * 12
          + creator.historyIdentities.size * 2
          - ([...creator.interestScores.keys()].some((key) => coveredInterests.has(key)) ? 20 : 0);
        return value(right) - value(left);
      })[0];
    if (!nextWatched) break;
    addCreator(nextWatched, "history");
  }

  const subscribedCreator = rankedCreators
    .filter((creator) => creator.subscribed
      && creator.historyIdentities.size >= 2
      && hasCreatorDiscoveryEvidence(creator, requestedTopics.includes("gaming"))
      && !creatorAlreadySelected(creator))
    .sort((left, right) => {
      const value = (creator: CreatorTaste) => creatorTasteScore(creator, globalInterestScores)
        - ([...creator.interestScores.keys()].some((key) => coveredInterests.has(key)) ? 20 : 0);
      return value(right) - value(left);
    })[0];
  if (selectedCreators.length < 4) addCreator(subscribedCreator, "subscription");

  if (selectedCreators.length < 4) {
    const likedCreator = rankedCreators.find((creator) => creator.likedCount > 0 && !creatorAlreadySelected(creator));
    addCreator(likedCreator, "liked");
  }

  if (selectedCreators.length < 4) addCreator(watchedCreators.find((creator) => !creatorAlreadySelected(creator)), "history");

  const rankedHistoryInterests = [...globalInterestEvidence.entries()]
    .filter(([, evidence]) => evidence.historyIdentities.size >= 3)
    .sort((left, right) => right[1].historyScore - left[1].historyScore);
  const strongestHistoryInterest = rankedHistoryInterests[0]?.[1].historyScore ?? 0;
  const allowedInterestKeys = [...new Set([
    ...rankedHistoryInterests
      .filter(([, evidence]) => evidence.historyScore >= Math.max(3, strongestHistoryInterest * 0.05))
      .slice(0, 5)
      .map(([key]) => key),
    ...[...globalInterestEvidence.entries()].filter(([, evidence]) => evidence.liked >= 2).map(([key]) => key)
  ])];
  const laneSpecs: Array<{ key: string; label: string; source: DiscoveryLane["source"]; seedChannelTitle: string | null; preferredInterestKeys: string[]; allowedInterestKeys: string[]; anchorTerms: string[]; queryBase: string; order: DiscoveryLane["order"]; durationVariant: 0 | 1; categoryId?: string }> = selectedCreators.slice(0, 4).map(({ creator, source }) => {
    const preferredInterests = strongCreatorInterestKeys(creator)
      .slice(0, 2)
      .map((key) => gamingInterest(key))
      .filter((interest): interest is NonNullable<typeof interest> => Boolean(interest));
    const anchorTerms = strongCreatorAnchorTerms(creator, requestedTopics.includes("gaming"));
    const creatorAllowedInterestKeys = [...new Set([...allowedInterestKeys, ...preferredInterests.map((interest) => interest.key)])];
    const interestQuery = requestedTopics.includes("gaming") ? preferredInterests.map((interest) => interest.query).join("|") : "";
    const anchorQuery = anchorTerms.join(" ");
    const topic = requestedTopics[0] ?? "video";
    return {
      key: `creator:${creator.key}`,
      label: creator.title,
      source,
      seedChannelTitle: creator.title,
      preferredInterestKeys: preferredInterests.map((interest) => interest.key),
      allowedInterestKeys: creatorAllowedInterestKeys,
      anchorTerms,
      queryBase: interestQuery && anchorQuery
        ? `${interestQuery} ${anchorTerms.slice(0, 2).join(" ")} gameplay`
        : interestQuery
          || (anchorQuery ? `${anchorQuery} ${requestedTopics.includes("gaming") ? "gameplay" : topic}` : `"${creator.title}" ${topic}`),
      order: interestQuery ? "viewCount" : "relevance",
      durationVariant: 0,
      categoryId: requestedTopics.includes("gaming") ? "20" : undefined
    };
  });

  if (requestedTopics.includes("gaming")) {
    if (laneSpecs.length < 2) {
      laneSpecs.push({
        key: "explore:gaming-variety",
        label: "variety gaming",
        source: "interest",
        seedChannelTitle: null,
        preferredInterestKeys: [],
        allowedInterestKeys,
        anchorTerms: ["multiplayer", "funny"],
        queryBase: "funny multiplayer gameplay",
        order: "viewCount",
        durationVariant: 0,
        categoryId: "20"
      });
    }
  } else {
    const topic = requestedTopics[0] ?? "interesting";
    const topicTerms = topicSearchTerms(topic).slice(0, 5).join("|");
    const intentTerm = intent === "relax" ? "documentary" : intentSearchTerms[intent][0];
    laneSpecs.push({
      key: `topic:${topic}:intent`,
      label: topic,
      source: "interest",
      seedChannelTitle: null,
      preferredInterestKeys: [],
      allowedInterestKeys: [],
      anchorTerms: [],
      queryBase: `${topic} ${intentTerm}`,
      order: "relevance",
      durationVariant: 0,
      categoryId: topicCategoryIdForSearch(topic)
    });
    laneSpecs.push({
      key: `topic:${topic}:popular`,
      label: topic,
      source: "interest",
      seedChannelTitle: null,
      preferredInterestKeys: [],
      allowedInterestKeys: [],
      anchorTerms: [],
      queryBase: topicTerms,
      order: "viewCount",
      durationVariant: 1,
      categoryId: topicCategoryIdForSearch(topic)
    });
  }

  if (!laneSpecs.length) {
    const historyTerms = historyTermsForSearch(relevantSignals, requestedTopics);
    const fallbackTerms = historyTerms.length ? historyTerms : (requestedTopics.length ? requestedTopics : ["interesting"]);
    for (const term of fallbackTerms.slice(0, 4)) laneSpecs.push({
      key: `fallback:${term}`,
      label: term,
      source: "fallback",
      seedChannelTitle: null,
      preferredInterestKeys: [],
      allowedInterestKeys: [],
      anchorTerms: [],
      queryBase: `${term} ${requestedTopics[0] ?? "video"}`,
      order: "relevance",
      durationVariant: 0,
      categoryId: requestedTopics.length === 1 ? topicCategoryIdForSearch(requestedTopics[0]) : undefined
    });
  }

  return laneSpecs.slice(0, 5).map((lane): DiscoveryLane => {
    return {
      ...lane,
      query: lane.queryBase.trim()
    };
  });
}

export function historyTermsForSearch(rows: WatchHistorySignal[], requestedTopics: string[]) {
  const relevantRows = rows.filter((row) => !requestedTopics.length || overlap(row.topics, requestedTopics).length > 0);
  const profile = buildHistoryTasteProfile(relevantRows);
  const ranked = [...profile.termWeights.entries()]
    .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))
    .map(([word]) => word);
  const repeated = ranked.filter((word) => (profile.termWeights.get(word) ?? 0) >= 1.5);
  return (repeated.length ? repeated : ranked).slice(0, 4);
}

export function discoverySearchQuery(topics: string[], historyTerms: string[], intent: RecommendationRequest["intent"], variant = 0) {
  const topic = topics[0] ?? "interesting documentary";
  const specificTopicTerms = topicSearchTerms(topic).filter((term) => term !== topic && !historyStopWords.has(term));
  const anchors = (historyTerms.length ? historyTerms : specificTopicTerms).slice(0, 3);
  const broadAnchor = anchors.length ? anchors.join("|") : topic;
  const focusedAnchor = anchors[0] ?? topic;
  const intentTerms = intentSearchTerms[intent];
  const intentTerm = intentTerms[variant % intentTerms.length];
  return variant === 0 ? `${broadAnchor} ${topic}`.trim() : `${focusedAnchor} ${intentTerm} ${topic}`.trim();
}

export function historyAffinity(
  video: Video & { channel: Channel },
  candidateTopics: string[],
  history: WatchHistorySignal[] | HistoryTasteProfile,
  anchors: string[] = []
) {
  const profile = Array.isArray(history) ? buildHistoryTasteProfile(history) : history;
  if (!profile.rowCount) return { score: 0, matched: false, anchor: null as string | null };
  const videoWords = titleWords(`${video.title} ${video.description ?? ""} ${(video.tags ?? []).join(" ")}`);
  const matchedAnchor = anchors.find((anchor) => videoWords.has(anchor.toLowerCase())) ?? null;
  const creator = profile.creatorWeights.get(creatorFamilyName(video.channel.title));
  const creatorScore = creator && profile.maxCreatorWeight
    ? 12 + Math.min(23, (creator.weight / profile.maxCreatorWeight) * 23)
    : 0;
  const matchingTerms = [...videoWords]
    .map((term) => ({ term, weight: profile.termWeights.get(term) ?? 0 }))
    .filter((item) => item.weight > 0)
    .sort((left, right) => right.weight - left.weight)
    .slice(0, 4);
  const termScore = profile.maxTermWeight
    ? Math.min(24, matchingTerms.reduce((sum, item) => sum + Math.min(8, (item.weight / profile.maxTermWeight) * 8), 0))
    : 0;
  const specificMatch = Boolean(creator) || Boolean(matchedAnchor) || matchingTerms.length >= 2;
  const topicScore = specificMatch
    ? Math.min(4, candidateTopics.reduce((sum, topic) => sum + (profile.topicWeights.get(topic) ?? 0), 0) / 20)
    : 0;
  const score = Math.min(35, Math.max(creatorScore, termScore + (matchedAnchor ? 6 : 0)) + topicScore);
  return { score, matched: specificMatch, anchor: matchedAnchor };
}

function titleSimilarity(left: string, right: string) {
  const leftWords = titleWords(left);
  const rightWords = titleWords(right);
  if (!leftWords.size || !rightWords.size) return 0;
  const shared = [...leftWords].filter((word) => rightWords.has(word)).length;
  return shared / Math.max(leftWords.size, rightWords.size);
}

export function discoveryLaneCapacity(resultCount: number, laneCount: number) {
  return laneCount > 1 ? Math.ceil(resultCount / laneCount) : resultCount;
}

export function favoriteSubscriptionSlots(resultCount: number, source: RecommendationRequest["source"]) {
  const subscribedSlots = source === "new" ? 0 : source === "subscribed" ? resultCount : Math.ceil(resultCount / 2);
  return Math.ceil(subscribedSlots * 0.7);
}

export function selectCandidates(scored: ScoredCandidate[], request: RecommendationRequest) {
  const pools = {
    subscribed: scored.filter((item) => item.candidate.source === VideoSource.SUBSCRIBED),
    new: scored.filter((item) => item.candidate.source === VideoSource.NEW)
  };
  const selected: ScoredCandidate[] = [];
  const activeDiscoveryLaneCount = new Set(scored
    .filter((item) => item.candidate.source === VideoSource.NEW && item.candidate.discoveryLane)
    .map((item) => item.candidate.discoveryLane!.key)).size;
  const discoveryLaneCount = activeDiscoveryLaneCount;
  const discoveryLaneCap = discoveryLaneCapacity(request.resultCount, discoveryLaneCount);
  const creatorLaneCap = discoveryLaneCapacity(request.resultCount, 5);
  const gameCapacity = Math.max(2, Math.ceil(request.resultCount / 4));
  const frequentCreatorTarget = favoriteSubscriptionSlots(request.resultCount, request.source);
  let totalMinutes = 0;
  const exceedsGameCapacity = (item: ScoredCandidate) => {
    if (!request.topics.includes("gaming")) return false;
    const video = item.candidate.video;
    const keys = gamingInterestKeys(`${video.title} ${(video.tags ?? []).join(" ")}`);
    return keys.some((key) => selected.filter((picked) => {
      const pickedVideo = picked.candidate.video;
      return gamingInterestKeys(`${pickedVideo.title} ${(pickedVideo.tags ?? []).join(" ")}`).includes(key);
    }).length >= gameCapacity);
  };

  for (const desiredSource of sourceOrder(request)) {
    const sourcePool = pools[desiredSource];
    const fallback = request.source === "mixed" ? pools[desiredSource === "new" ? "subscribed" : "new"] : [];
    const sortOptions = (values: ScoredCandidate[]) => [...values].sort((left, right) => {
      const penalty = (item: ScoredCandidate) => selected.reduce((sum, picked) => sum
        + (item.candidate.video.channelId === picked.candidate.video.channelId ? 18 : 0)
        + (item.candidate.discoveryLane?.key && item.candidate.discoveryLane.key === picked.candidate.discoveryLane?.key ? 16 : 0)
        + (overlap(item.candidate.video.topics, picked.candidate.video.topics).length ? 8 : 0), 0);
      const titlePenalty = (item: ScoredCandidate) => selected.reduce((sum, picked) => sum
        + (titleSimilarity(item.candidate.video.title, picked.candidate.video.title) >= 0.7 ? 18 : 0), 0);
      const singleDistance = (item: ScoredCandidate) => request.recommendationMode === "single" && request.timeLimitEnabled
        ? Math.abs(item.durationMinutes - request.minutes)
        : 0;
      const newestOrder = request.sortBy === "newest"
        ? (right.candidate.video.publishedAt?.getTime() ?? 0) - (left.candidate.video.publishedAt?.getTime() ?? 0)
        : 0;
      return newestOrder
        || (singleDistance(left) - singleDistance(right))
        || ((right.match - penalty(right) - titlePenalty(right)) - (left.match - penalty(left) - titlePenalty(left)));
    });
    const selectedFrequent = selected.filter((item) => item.candidate.source === VideoSource.SUBSCRIBED && item.frequentCreator).length;
    const preferFrequent = desiredSource === "subscribed" && selectedFrequent < frequentCreatorTarget;
    const frequent = preferFrequent ? sourcePool.filter((item) => item.frequentCreator) : [];
    const regular = preferFrequent ? sourcePool.filter((item) => !item.frequentCreator) : sourcePool;
    const options = [...sortOptions(frequent), ...sortOptions(regular), ...sortOptions(fallback)];
    const next = options.find((item) => {
      if (selected.some((picked) => picked.candidate.video.id === item.candidate.video.id)) return false;
      if (selected.filter((picked) => picked.candidate.video.channelId === item.candidate.video.channelId).length >= 2) return false;
      if (exceedsGameCapacity(item)) return false;
      if (item.candidate.topicOverride && selected.some((picked) => picked.candidate.topicOverride && picked.candidate.video.channelId === item.candidate.video.channelId)) return false;
      if (item.candidate.discoveryLane) {
        const selectedFromLane = selected.filter((picked) => picked.candidate.discoveryLane?.key === item.candidate.discoveryLane?.key).length;
        const creatorLed = ["history", "subscription", "liked"].includes(item.candidate.discoveryLane.source);
        if (selectedFromLane >= (creatorLed ? creatorLaneCap : discoveryLaneCap)) return false;
      }
      return request.recommendationMode === "single"
        || !request.timeLimitEnabled
        || totalMinutes + item.durationMinutes <= request.minutes;
    });
    if (!next) continue;
    selected.push(next);
    totalMinutes += next.durationMinutes;
  }

  const backfill = request.sortBy === "newest"
    ? [...scored].sort((left, right) => (right.candidate.video.publishedAt?.getTime() ?? 0) - (left.candidate.video.publishedAt?.getTime() ?? 0))
    : scored;
  for (const item of backfill) {
    if (selected.length >= request.resultCount) break;
    if (selected.some((picked) => picked.candidate.video.id === item.candidate.video.id)) continue;
    if (selected.filter((picked) => picked.candidate.video.channelId === item.candidate.video.channelId).length >= 2) continue;
    if (exceedsGameCapacity(item)) continue;
    if (item.candidate.discoveryLane) {
      const selectedFromLane = selected.filter((picked) => picked.candidate.discoveryLane?.key === item.candidate.discoveryLane?.key).length;
      if (selectedFromLane >= Math.max(2, discoveryLaneCap + 1)) continue;
    }
    if (item.candidate.topicOverride && selected.some((picked) => picked.candidate.topicOverride && picked.candidate.video.channelId === item.candidate.video.channelId)) continue;
    if (request.recommendationMode !== "single" && request.timeLimitEnabled && totalMinutes + item.durationMinutes > request.minutes) continue;
    selected.push(item);
    totalMinutes += item.durationMinutes;
  }
  return request.sortBy === "newest"
    ? selected.sort((left, right) => (right.candidate.video.publishedAt?.getTime() ?? 0) - (left.candidate.video.publishedAt?.getTime() ?? 0))
    : selected;
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
}, hasMore: boolean, quotaLimited = false, emptyReason?: "quota_limited" | "no_filter_matches" | "no_fresh_matches" | "no_source_matches", seenVideoIds?: string[]) {
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
  request = normalizeRecommendationRequest({ ...request, topics: normalizeSessionTopics(request.topics) });
  const storedProfile = await db.viewerProfile.findUniqueOrThrow({ where: { userId } });
  const profile = serializeProfile(storedProfile);
  const historyRows = await db.watchHistoryItem.findMany({ where: { userId }, orderBy: { watchedAt: "desc" }, take: 5000 });
  const historyVideoIds = [...new Set(historyRows.flatMap((row) => row.videoId ? [row.videoId] : []))];
  const knownHistoryVideos = historyVideoIds.length
    ? await db.video.findMany({ where: { id: { in: historyVideoIds } }, include: { channel: true } })
    : [];
  let quotaLimited = false;
  let currentNewVideoIds = new Set<string>();
  let currentLanesByVideoId = new Map<string, DiscoveryLane[]>();
  let currentDiscoveryLanes: DiscoveryLane[] = [];
  if (request.source !== "subscribed") {
    const search = await searchNewVideos(userId, request, profile, historyRows, knownHistoryVideos);
    quotaLimited = search.quotaLimited;
    currentNewVideoIds = search.candidateVideoIds;
    currentLanesByVideoId = search.lanesByVideoId;
    currentDiscoveryLanes = search.lanes;
  }

  const candidateSourceFilters: Prisma.UserVideoCandidateWhereInput[] = [
    { source: VideoSource.SUBSCRIBED },
    ...(currentNewVideoIds.size ? [{ source: VideoSource.NEW, videoId: { in: [...currentNewVideoIds] } } as Prisma.UserVideoCandidateWhereInput] : [])
  ];

  const [candidateRows, likedRows, feedbackRows, activityRows, savedRows, watchedRows] = await Promise.all([
    db.userVideoCandidate.findMany({ where: { userId, expiresAt: { gt: new Date() }, OR: candidateSourceFilters }, include: { video: { include: { channel: true } } } }),
    db.likedVideo.findMany({ where: { userId }, include: { video: { include: { channel: true } } } }),
    db.recommendationFeedback.findMany({ where: { userId }, include: { video: true } }),
    db.viewingActivity.findMany({ where: { userId, createdAt: { gt: new Date(Date.now() - 90 * 86_400_000) } }, include: { video: true } }),
    db.savedVideo.findMany({ where: { userId }, include: { video: true } }),
    db.watchedVideo.findMany({ where: { userId }, select: { videoId: true } })
  ]);
  const requestedTopics = request.topics.length ? request.topics : [...profile.interests, ...profile.customTopics];
  const enrichedHistoryRows = enrichWatchHistorySignals(historyRows, [
    ...knownHistoryVideos,
    ...candidateRows.map((row) => row.video),
    ...likedRows.map((row) => row.video)
  ]);
  const historyTaste = buildHistoryTasteProfile(enrichedHistoryRows);
  const likedChannelIds = new Set(profile.useLikedVideos ? likedRows.map((row) => row.video.channelId) : []);
  const openedChannelIds = new Set(activityRows.filter((row) => row.type === "OPENED").map((row) => row.video.channelId));
  const savedChannelIds = new Set(savedRows.map((row) => row.video.channelId));
  const creatorAffinities = profile.useWatchHistory
    ? buildCreatorAffinities(
      enrichedHistoryRows,
      candidateRows.filter((row) => row.source === VideoSource.SUBSCRIBED).map((row) => row.video),
      likedChannelIds,
      openedChannelIds,
      savedChannelIds
    )
    : new Map<string, CreatorAffinity>();
  const candidates: Candidate[] = candidateRows.map((row) => {
    const creatorAffinity = creatorAffinities.get(creatorFamilyName(row.video.channel.title));
    const topicOverride = row.source === VideoSource.SUBSCRIBED
      && request.topics.length === 1
      && request.topics[0] === "gaming"
      && controlledGamingOverride(row.video, creatorAffinity);
    return {
      source: row.source,
      video: row.video,
      creatorAffinity,
      topicOverride,
      discoveryLane: row.source === VideoSource.NEW ? currentLanesByVideoId.get(row.videoId)?.[0] : undefined
    };
  });
  const historyAnchors = profile.useWatchHistory ? historyTermsForSearch(enrichedHistoryRows, requestedTopics) : [];
  const likedTopics = profile.useLikedVideos ? likedRows.flatMap((row) => row.video.topics) : [];
  const likedChannels = likedChannelIds;
  const openedTopics = activityRows.filter((row) => row.type === "OPENED").flatMap((row) => row.video.topics);
  const savedTopics = savedRows.flatMap((row) => row.video.topics);
  const excludedVideoIds = new Set([
    ...feedbackRows.map((row) => row.videoId),
    ...watchedRows.map((row) => row.videoId),
    ...(profile.useWatchHistory ? historyRows.flatMap((row) => row.videoId ? [row.videoId] : []) : []),
    ...(options.excludedVideoIds ?? [])
  ]);
  const scored = candidates.flatMap((candidate) => {
    const source = candidate.source === VideoSource.SUBSCRIBED ? "subscribed" : "new";
    const video = candidate.video;
    const topics = [...new Set([...effectiveTopics(video), ...(candidate.topicOverride ? ["gaming"] : [])])];
    const discoveryText = `${video.title} ${video.description ?? ""} ${video.tags.join(" ")} ${video.channel.title}`;
    const decisiveDiscoveryText = `${video.title} ${video.tags.join(" ")}`;
    const laneEvidence = candidate.discoveryLane
      ? personalizedDiscoveryEvidence(candidate.discoveryLane, discoveryText, decisiveDiscoveryText)
      : { matchingInterests: [], matchingAnchors: [], hasUnsupportedSpecificInterest: false, matched: false };
    const personalLane = candidate.discoveryLane ? isPersonalDiscoveryLane(candidate.discoveryLane) : false;
    const freshness = freshnessForVideo(video.publishedAt, request.maxAgeMonths);
    const history = profile.useWatchHistory ? historyAffinity(video, topics, historyTaste, historyAnchors) : { score: 0, matched: false, anchor: null };
    if (excludedVideoIds.has(video.id)) return [];
    if (!freshness.allowed) return [];
    if (request.source !== "mixed" && request.source !== source) return [];
    if (source === "new" && !isPopularNewCreator(video.viewCount, video.likeCount)) return [];
    if (source === "new" && request.antiClickbait && isLowTrustDiscoveryTitle(video.title, video.channel.title)) return [];
    const candidateLanguage = video.language === "pl" || video.language === "en" ? video.language : null;
    if (!request.formats.includes(video.format as never) || !candidateLanguage || !request.languages.includes(candidateLanguage)) return [];
    if (request.topics.length && !overlap(topics, request.topics).length) return [];
    if (!candidate.topicOverride && topicCategoryMismatch(video, request.topics.length ? request.topics : requestedTopics)) return [];
    if (!candidate.topicOverride && request.topics.length === 1 && !hasStrongTopicEvidence(video, request.topics[0])) return [];
    if (hasExcludedTopicConflict(video, topics, profile.excludedTopics, request.topics)) return [];
    if (request.audioFriendly && !video.audioFriendly) return [];
    if (source === "new" && currentDiscoveryLanes.length > 0 && !candidate.discoveryLane) return [];
    if (source === "new" && requestedTopics.includes("gaming") && personalLane && !laneEvidence.matched) return [];

    const topicMatches = overlap(topics, requestedTopics);
    const intentMatch = video.intents.includes(request.intent);
    const intentScore = intentMatch ? 15 : 0;
    const topicScore = topicMatches.length ? 20 : 0;
    const discoveryAffinity = candidate.discoveryLane
      ? discoveryPreferenceScore(candidate.discoveryLane.source, candidate.discoveryLane.preferredInterestKeys, candidate.discoveryLane.anchorTerms, discoveryText)
      : 0;
    const historyLaneScore = profile.useWatchHistory && candidate.discoveryLane?.source === "history" && laneEvidence.matched
      ? Math.min(35, 26 + Math.min(9, discoveryPreferenceScore("history", candidate.discoveryLane.preferredInterestKeys, candidate.discoveryLane.anchorTerms, discoveryText) - 18))
      : 0;
    const historyScore = profile.useWatchHistory ? Math.max(history.score, historyLaneScore) : 0;
    const affinityRaw = overlap(topics, likedTopics).length * 12
      + (likedChannels.has(video.channelId) ? 28 : 0)
      + overlap(topics, openedTopics).length * 4
      + overlap(topics, savedTopics).length * 6
      + (candidate.discoveryLane?.source === "liked" ? discoveryAffinity : 0);
    const affinityScore = Math.min(12, affinityRaw / 5);
    const durationMinutes = Math.max(1, Math.ceil(video.durationSeconds / 60));
    const durationScore = durationFit(durationMinutes, request) * (2 / 3);
    const popularity = popularityScore(video, source);
    const feedbackPenalty = feedbackPenaltyForVideo(video, topics, feedbackRows)
      + (request.antiClickbait ? video.clickbaitScore * 0.15 : 0);
    const match = Math.max(0, Math.min(100, Math.round(intentScore + topicScore + historyScore + affinityScore + durationScore + popularity - feedbackPenalty - freshness.penalty)));
    const sourceSignal = source === "subscribed" ? "From your subscriptions" : "New creator discovery";
    const popularitySignal = source === "new" ? "Popular on YouTube" : null;
    const laneInterestMatches = laneEvidence.matchingInterests;
    const laneSignal = candidate.discoveryLane
      ? candidate.discoveryLane.source === "history" ? laneInterestMatches.length
        ? `A familiar game from your ${candidate.discoveryLane.label} viewing`
        : laneEvidence.matched ? `Similar to videos you watch from ${candidate.discoveryLane.label}` : null
        : candidate.discoveryLane.source === "subscription" ? laneEvidence.matched ? `Similar to your subscription to ${candidate.discoveryLane.label}` : null
          : candidate.discoveryLane.source === "liked" ? `Inspired by videos you liked from ${candidate.discoveryLane.label}`
            : `Broadens your ${candidate.discoveryLane.label} options`
      : null;
    const favoriteSignal = candidate.creatorAffinity?.frequent ? "Frequently watched channel" : null;
    const tasteSignal = favoriteSignal ?? laneSignal ?? (history.matched
      ? history.anchor ? `Similar to your ${history.anchor} viewing` : "Shares specific themes with your watch history"
      : affinityRaw >= 40 ? "Strong liked-video fit" : topicMatches[0] ? `Matches your ${topicMatches[0]} interest` : null);
    const intentSignal = intentMatch ? `Fits ${request.intent}` : null;
    const signals = [sourceSignal, intentSignal ?? popularitySignal ?? freshness.signal, tasteSignal ?? popularitySignal ?? freshness.signal].filter((signal): signal is string => Boolean(signal)).slice(0, 3);
    const reason = `${freshnessReason(source, freshness.signal)}.${intentSignal ? ` ${intentSignal}.` : ""}${tasteSignal ? ` ${tasteSignal}.` : ""}`;
    return [{ candidate, match, reason, signals, durationMinutes, frequentCreator: Boolean(candidate.creatorAffinity?.frequent) }];
  }).sort((left, right) => right.match - left.match);

  const selected = selectCandidates(scored, request);
  const hasFreshCandidate = candidates.some((candidate) => freshnessForVideo(candidate.video.publishedAt, request.maxAgeMonths).allowed);
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
      request: { ...request, algorithmVersion: recommendationAlgorithmVersion } as Prisma.InputJsonValue,
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
  selected.length ? undefined : quotaLimited ? "quota_limited" : candidates.length && !hasFreshCandidate ? "no_fresh_matches" : candidates.length ? "no_filter_matches" : "no_source_matches");
}

export async function getLatestLiveSession(userId: string) {
  const latest = await db.recommendationSession.findFirst({
    where: { userId },
    orderBy: { createdAt: "desc" },
    include: { items: { orderBy: { position: "asc" }, include: { video: { include: { channel: true } } } } }
  });
  if (!latest) return null;
  if (storedAlgorithmVersion(latest.request) !== recommendationAlgorithmVersion) return null;
  const seen = await db.recommendationItem.findMany({
    where: { session: { userId, chainId: latest.chainId } },
    select: { videoId: true }
  });
  return sessionResponse(latest, latest.hasMore, false, undefined, seen.map((item) => item.videoId));
}

export async function buildNextLiveSession(userId: string, sessionId: string) {
  const previous = await db.recommendationSession.findFirst({ where: { id: sessionId, userId } });
  const request = previous ? normalizeStoredRequest(previous.request) : null;
  if (!previous || !request || storedAlgorithmVersion(previous.request) !== recommendationAlgorithmVersion) {
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
