import { createHash, randomUUID } from "node:crypto";
import { env } from "../config/env.js";
import { db } from "../db.js";
import { VideoSource } from "../generated/prisma/enums.js";
import type { Video, Channel, Prisma } from "../generated/prisma/client.js";
import { isRecommendationRequest, type RecommendationRequest, type ViewerProfileInput } from "../viewer/contracts.js";
import { serializeProfile } from "../viewer/profile.js";
import { classifyTopicsFromText, topicSearchTerms } from "./classification.js";
import { upsertVideo, videoDetails, youtubeForUser } from "./youtubeLive.js";

type DiscoveryLane = {
  key: string;
  label: string;
  query: string;
  source: "history" | "subscription" | "liked" | "interest" | "fallback";
  seedChannelTitle: string | null;
  interestKeys: string[];
  anchorTerms: string[];
};

type Candidate = {
  source: VideoSource;
  video: Video & { channel: Channel };
  discoveryLane?: DiscoveryLane;
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

const freshnessCacheVersion = "creator-affinity-v16";
const recommendationAlgorithmVersion = "creator-affinity-v17";
const dayMs = 86_400_000;

export function subscriptionCandidateExpiration(now = new Date()) {
  return new Date(now.getTime() + env.subscriptionCandidateDays * dayMs);
}

export function isPopularNewCreator(viewCount: bigint | null, likeCount: bigint | null = null) {
  const views = Number(viewCount ?? 0);
  const likes = Number(likeCount ?? 0);
  const minimumViews = Math.max(25_000, env.minimumNewCreatorViews);
  if (views < minimumViews) return false;
  if (views >= 100_000) return true;
  return likes >= 500 || (views > 0 && likes / views >= 0.015);
}

export function isLowTrustDiscoveryTitle(title: string, channelTitle = "") {
  return /\b(skibidi|slow english|good boy vs bad boy|ai generated)\b|\bepisode\s*\d+\b|\b(?:minecraft|roblox)\s+animation\b/iu.test(title)
    || /(?:^|\W)(?:kids?|toons?)(?:$|\W)/iu.test(channelTitle);
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

export function youtubeSearchParameters(query: string, language: string, maxAgeMonths: RecommendationRequest["maxAgeMonths"] = 12, now = new Date(), categoryId?: string, videoDuration?: "short" | "medium" | "long", order: "relevance" | "viewCount" = "relevance") {
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

type WatchHistorySignal = { title: string; channelTitle: string | null; topics: string[]; watchedAt?: Date };
type DiscoveryTasteSignal = WatchHistorySignal & {
  origin: "history" | "subscription" | "liked";
  metadataText?: string;
};

function discoveryMetadata(video: Pick<Video, "description" | "tags">) {
  const description = (video.description ?? "").replace(/https?:\/\/\S+/giu, " ").slice(0, 500);
  const hashtags = (video.description ?? "").match(/#[\p{L}\p{N}_-]+/gu) ?? [];
  return `${video.tags.join(" ")} ${description} ${hashtags.join(" ")}`.trim();
}

async function searchNewVideos(userId: string, request: RecommendationRequest, profile: ViewerProfileInput, historyRows: WatchHistorySignal[]) {
  const topics = (request.topics.length ? request.topics : [...profile.interests, ...profile.customTopics]).slice(0, 2);
  const languages = request.languages.slice(0, 2);
  const subscriptions = await db.subscription.findMany({ where: { userId }, include: { channel: true } });
  const subscribedChannels = new Set(subscriptions.map((item) => item.channelId));
  const subscribedTitles = new Set(subscriptions.map((item) => normalizeCreatorName(item.channel.title)));
  const categoryId = topics.includes("gaming") ? "20" : undefined;
  const [subscriptionCandidates, likedRows] = await Promise.all([
    db.userVideoCandidate.findMany({
      where: { userId, source: VideoSource.SUBSCRIBED, expiresAt: { gt: new Date() } },
      include: { video: { include: { channel: true } } }
    }),
    db.likedVideo.findMany({ where: { userId }, include: { video: { include: { channel: true } } } })
  ]);
  const tasteSignals: DiscoveryTasteSignal[] = [
    ...(profile.useWatchHistory ? historyRows.map((row) => ({ ...row, origin: "history" as const })) : []),
    ...subscriptionCandidates.map((row) => ({
      title: row.video.title,
      channelTitle: row.video.channel.title,
      topics: row.video.topics,
      watchedAt: row.discoveredAt,
      origin: "subscription" as const,
      metadataText: discoveryMetadata(row.video)
    })),
    ...(profile.useLikedVideos ? likedRows.map((row) => ({
      title: row.video.title,
      channelTitle: row.video.channel.title,
      topics: row.video.topics,
      watchedAt: row.importedAt,
      origin: "liked" as const,
      metadataText: discoveryMetadata(row.video)
    })) : [])
  ];
  const lanes = buildDiscoveryLanes(tasteSignals, topics, subscribedTitles);
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
      const candidateText = `${video.title} ${video.description ?? ""} ${video.tags.join(" ")} ${video.channel.title}`;
      if (!subscribed && lane.interestKeys.length) {
        const candidateInterests = gamingInterestKeys(candidateText);
        if (!lane.interestKeys.some((key) => candidateInterests.includes(key as never))) continue;
      } else if (!subscribed && lane.seedChannelTitle) {
        const normalizedCandidate = normalizeCreatorName(candidateText);
        const mentionsSeed = normalizedCandidate.includes(normalizeCreatorName(lane.seedChannelTitle));
        const matchesAnchor = lane.anchorTerms.some((term) => containsPhrase(candidateText.toLowerCase(), term));
        if (!mentionsSeed && !matchesAnchor) continue;
      }
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
    const durationVariant = request.formats.length === 1 && request.formats[0] === "standard" && !request.timeLimitEnabled ? 0 : index;
    const videoDuration = searchDurationForFormats(request.formats, durationVariant);
    const order = lane.interestKeys.length ? "viewCount" as const : "relevance" as const;
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

export function freshnessReason(source: "subscribed" | "new", signal: string) {
  const origin = source === "new" ? "A perspective beyond your subscriptions" : "A video from a channel you follow";
  return `${origin}. ${signal}`;
}

function normalizeStoredRequest(value: Prisma.JsonValue): RecommendationRequest | null {
  if (isRecommendationRequest(value)) return value;
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const legacyMode = "recommendationMode" in value && value.recommendationMode === "single" ? "single" : "session";
  const legacy = {
    ...value,
    timeLimitEnabled: "timeLimitEnabled" in value ? value.timeLimitEnabled : true,
    recommendationMode: legacyMode,
    resultCount: "resultCount" in value ? value.resultCount : legacyMode === "single" ? 5 : 3,
    maxAgeMonths: 12
  };
  return isRecommendationRequest(legacy) ? legacy : null;
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
  const categoryTopics: Record<string, string[]> = {
    "17": ["health"],
    "20": ["gaming"],
    "10": ["music"]
  };
  return [...new Set([
    ...video.topics,
    ...classifyTopicsFromText(`${video.channel.title} ${video.channel.description ?? ""}`),
    ...(video.categoryId ? categoryTopics[video.categoryId] ?? [] : [])
  ])];
}

export function topicCategoryMismatch(video: Pick<Video, "categoryId">, requestedTopics: string[]) {
  if (requestedTopics.includes("gaming")) return video.categoryId !== "20";
  return video.categoryId === "20" && requestedTopics.length > 0;
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

function containsPhrase(value: string, phrase: string) {
  const escaped = phrase.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`(?:^|[^\\p{L}\\p{N}])${escaped}(?:$|[^\\p{L}\\p{N}])`, "iu").test(value);
}

export function gamingInterestKeys(value: string) {
  const normalized = value.toLowerCase();
  return gamingInterests.filter((interest) => interest.aliases.some((alias) => containsPhrase(normalized, alias))).map((interest) => interest.key);
}

function gamingInterest(key: string) {
  return gamingInterests.find((interest) => interest.key === key);
}

function normalizeCreatorName(value: string) {
  return value.toLowerCase().normalize("NFKD").replace(/[^\p{L}\p{N}]+/gu, "").trim();
}

export function creatorFamilyName(value: string) {
  return normalizeCreatorName(value)
    .replace(/^(?:more|the)/u, "")
    .replace(/(?:plus|extra|clips|shorts|gaming|games|tv|pops|high|low)$/u, "");
}

type CreatorTaste = {
  key: string;
  title: string;
  historyCount: number;
  subscriptionCount: number;
  likedCount: number;
  subscribed: boolean;
  interestScores: Map<string, number>;
  termScores: Map<string, number>;
};

function creatorTasteScore(creator: CreatorTaste, globalInterestScores: Map<string, number>) {
  const affinity = Math.min(creator.historyCount, 12) * 4
    + Math.min(creator.likedCount, 8) * 5
    + Math.min(creator.subscriptionCount, 8) * 2
    + (creator.subscribed ? 8 : 0);
  const interestAffinity = [...creator.interestScores.keys()].reduce((sum, key) => sum + Math.min(8, globalInterestScores.get(key) ?? 0), 0);
  return affinity + interestAffinity;
}

export function buildDiscoveryLanes(
  signals: DiscoveryTasteSignal[],
  requestedTopics: string[],
  subscribedTitles = new Set<string>()
) {
  const directlyRelevant = (signal: DiscoveryTasteSignal) => {
    if (!requestedTopics.length) return true;
    if (overlap(signal.topics, requestedTopics).length) return true;
    return requestedTopics.includes("gaming") && gamingInterestKeys(`${signal.title} ${signal.metadataText ?? ""} ${signal.channelTitle ?? ""}`).length > 0;
  };
  const signalsByCreator = new Map<string, DiscoveryTasteSignal[]>();
  for (const signal of signals) {
    if (!signal.channelTitle) continue;
    const key = normalizeCreatorName(signal.channelTitle);
    const creatorSignals = signalsByCreator.get(key) ?? [];
    creatorSignals.push(signal);
    signalsByCreator.set(key, creatorSignals);
  }
  const relevantCreatorKeys = new Set([...signalsByCreator.entries()].flatMap(([key, creatorSignals]) => {
    const directCount = creatorSignals.filter(directlyRelevant).length;
    return directCount >= 3 && directCount / creatorSignals.length >= 0.25 ? [key] : [];
  }));
  const relevantSignals = signals.filter((signal) => directlyRelevant(signal)
    || Boolean(signal.channelTitle && relevantCreatorKeys.has(normalizeCreatorName(signal.channelTitle))));
  const creators = new Map<string, CreatorTaste>();
  const globalInterestScores = new Map<string, number>();

  for (const signal of relevantSignals) {
    const interestKeys = requestedTopics.includes("gaming") ? gamingInterestKeys(`${signal.title} ${signal.metadataText ?? ""} ${signal.channelTitle ?? ""}`) : [];
    const signalWeight = signal.origin === "liked" ? 5 : signal.origin === "history" ? 3 : 2;
    for (const key of new Set(interestKeys)) globalInterestScores.set(key, (globalInterestScores.get(key) ?? 0) + signalWeight);
    if (!signal.channelTitle) continue;
    const key = normalizeCreatorName(signal.channelTitle);
    if (!key) continue;
    const creator = creators.get(key) ?? {
      key,
      title: signal.channelTitle,
      historyCount: 0,
      subscriptionCount: 0,
      likedCount: 0,
      subscribed: subscribedTitles.has(key),
      interestScores: new Map<string, number>(),
      termScores: new Map<string, number>()
    };
    if (signal.origin === "history") creator.historyCount += 1;
    if (signal.origin === "subscription") creator.subscriptionCount += 1;
    if (signal.origin === "liked") creator.likedCount += 1;
    creator.subscribed ||= subscribedTitles.has(key);
    for (const interestKey of new Set(interestKeys)) creator.interestScores.set(interestKey, (creator.interestScores.get(interestKey) ?? 0) + signalWeight);
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
    .filter((creator) => creator.historyCount >= 2)
    .sort((left, right) => right.historyCount - left.historyCount
      || right.likedCount - left.likedCount
      || creatorTasteScore(right, globalInterestScores) - creatorTasteScore(left, globalInterestScores));
  while (selectedCreators.filter((item) => item.source === "history").length < 4) {
    const nextWatched = watchedCreators
      .filter((creator) => !creatorAlreadySelected(creator))
      .sort((left, right) => {
        const value = (creator: CreatorTaste) => creator.historyCount * 10
          - ([...creator.interestScores.keys()].some((key) => coveredInterests.has(key)) ? 1_000 : 0);
        return value(right) - value(left);
      })[0];
    if (!nextWatched) break;
    addCreator(nextWatched, "history");
  }

  const subscribedCreator = rankedCreators
    .filter((creator) => creator.subscribed && !creatorAlreadySelected(creator))
    .sort((left, right) => {
      const value = (creator: CreatorTaste) => creatorTasteScore(creator, globalInterestScores)
        - ([...creator.interestScores.keys()].some((key) => coveredInterests.has(key)) ? 1_000 : 0);
      return value(right) - value(left);
    })[0];
  addCreator(subscribedCreator, "subscription");

  if (selectedCreators.length < 3) {
    const likedCreator = rankedCreators.find((creator) => creator.likedCount > 0 && !creatorAlreadySelected(creator));
    addCreator(likedCreator, "liked");
  }

  const laneSpecs: Array<{ key: string; label: string; source: DiscoveryLane["source"]; seedChannelTitle: string | null; interestKeys: string[]; anchorTerms: string[]; queryBase: string }> = selectedCreators.slice(0, 5).map(({ creator, source }) => {
    const rankedInterestEntries = [...creator.interestScores.entries()].sort((left, right) => right[1] - left[1]);
    const totalSignalWeight = creator.historyCount * 3 + creator.subscriptionCount * 2 + creator.likedCount * 5;
    const concentrationThreshold = source === "subscription" ? 0.08 : 0.2;
    const concentratedInterests = rankedInterestEntries
      .filter(([, score]) => score >= Math.max(5, totalSignalWeight * concentrationThreshold))
      .slice(0, 2)
      .map(([key]) => gamingInterest(key))
      .filter((interest): interest is NonNullable<typeof interest> => Boolean(interest));
    const anchorTerms = [...creator.termScores.entries()]
      .filter(([, score]) => score >= 6)
      .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))
      .slice(0, 3)
      .map(([term]) => term);
    const interestQuery = concentratedInterests.map((interest) => interest.query).join("|");
    return {
      key: `creator:${creator.key}`,
      label: creator.title,
      source,
      seedChannelTitle: creator.title,
      interestKeys: concentratedInterests.map((interest) => interest.key),
      anchorTerms,
      queryBase: interestQuery || `"${creator.title}" ${requestedTopics.includes("gaming") ? "gaming" : requestedTopics[0] ?? "video"}`
    };
  });

  const rankedInterests = [...globalInterestScores.entries()]
    .sort((left, right) => right[1] - left[1])
    .map(([key]) => gamingInterest(key))
    .filter((interest): interest is NonNullable<typeof interest> => Boolean(interest));
  const uncoveredInterest = rankedInterests.find((interest) => !coveredInterests.has(interest.key)) ?? rankedInterests[0];
  if (uncoveredInterest && laneSpecs.length < 5) laneSpecs.push({
    key: `interest:${uncoveredInterest.key}`,
    label: uncoveredInterest.label,
    source: "interest",
    seedChannelTitle: null,
    interestKeys: [uncoveredInterest.key],
    anchorTerms: [],
    queryBase: `${uncoveredInterest.query} ${requestedTopics[0] ?? "video"}`
  });

  for (const interest of rankedInterests) {
    if (laneSpecs.length >= 5) break;
    if (laneSpecs.some((lane) => lane.key === `interest:${interest.key}`)) continue;
    laneSpecs.push({ key: `interest:${interest.key}`, label: interest.label, source: "interest", seedChannelTitle: null, interestKeys: [interest.key], anchorTerms: [], queryBase: `${interest.query} ${requestedTopics[0] ?? "video"}` });
  }

  if (!laneSpecs.length) {
    const historyTerms = historyTermsForSearch(relevantSignals, requestedTopics);
    const fallbackTerms = historyTerms.length ? historyTerms : (requestedTopics.length ? requestedTopics : ["interesting"]);
    for (const term of fallbackTerms.slice(0, 4)) laneSpecs.push({
      key: `fallback:${term}`,
      label: term,
      source: "fallback",
      seedChannelTitle: null,
      interestKeys: [],
      anchorTerms: [],
      queryBase: `${term} ${requestedTopics[0] ?? "video"}`
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
  const counts = new Map<string, number>();
  const relevantRows = rows.filter((row) => !requestedTopics.length || overlap(row.topics, requestedTopics).length > 0);
  for (const row of relevantRows) {
    for (const word of titleWords(`${row.title} ${row.channelTitle ?? ""}`)) counts.set(word, (counts.get(word) ?? 0) + 1);
  }
  const ranked = [...counts.entries()]
    .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))
    .map(([word]) => word);
  const repeated = ranked.filter((word) => (counts.get(word) ?? 0) >= 2);
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

export function historyAffinity(video: Video & { channel: Channel }, candidateTopics: string[], rows: WatchHistorySignal[], anchors: string[] = []) {
  if (!rows.length) return { score: 0, matched: false, anchor: null as string | null };
  const videoWords = titleWords(`${video.title} ${video.channel.title}`);
  const matchedAnchor = anchors.find((anchor) => videoWords.has(anchor.toLowerCase())) ?? null;
  let best = 0;
  let hasSpecificMatch = Boolean(matchedAnchor);
  for (const row of rows) {
    const sameChannel = Boolean(row.channelTitle && row.channelTitle.toLowerCase() === video.channel.title.toLowerCase());
    const sharedWords = [...titleWords(`${row.title} ${row.channelTitle ?? ""}`)].filter((word) => videoWords.has(word));
    const sharedTopics = overlap(candidateTopics, row.topics);
    const specificScore = (sameChannel ? 16 : 0) + Math.min(12, sharedWords.length * 6) + (matchedAnchor ? 10 : 0);
    const score = specificScore + Math.min(3, sharedTopics.length);
    best = Math.max(best, score);
    hasSpecificMatch ||= sameChannel || sharedWords.length >= 2;
  }
  return { score: best, matched: hasSpecificMatch, anchor: matchedAnchor };
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

function selectCandidates(scored: ScoredCandidate[], request: RecommendationRequest) {
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
  let totalMinutes = 0;

  for (const desiredSource of sourceOrder(request)) {
    const sourcePool = pools[desiredSource];
    const fallback = request.source === "mixed" ? pools[desiredSource === "new" ? "subscribed" : "new"] : [];
    const options = [...sourcePool, ...fallback].sort((left, right) => {
      const penalty = (item: ScoredCandidate) => selected.reduce((sum, picked) => sum
        + (item.candidate.video.channelId === picked.candidate.video.channelId ? 18 : 0)
        + (item.candidate.discoveryLane?.key && item.candidate.discoveryLane.key === picked.candidate.discoveryLane?.key ? 16 : 0)
        + (overlap(item.candidate.video.topics, picked.candidate.video.topics).length ? 8 : 0), 0);
      const titlePenalty = (item: ScoredCandidate) => selected.reduce((sum, picked) => sum
        + (titleSimilarity(item.candidate.video.title, picked.candidate.video.title) >= 0.7 ? 18 : 0), 0);
      const singleDistance = (item: ScoredCandidate) => request.recommendationMode === "single" && request.timeLimitEnabled
        ? Math.abs(item.durationMinutes - request.minutes)
        : 0;
      return (singleDistance(left) - singleDistance(right))
        || ((right.match - penalty(right) - titlePenalty(right)) - (left.match - penalty(left) - titlePenalty(left)));
    });
    const next = options.find((item) => {
      if (selected.some((picked) => picked.candidate.video.id === item.candidate.video.id)) return false;
      if (item.candidate.source === VideoSource.NEW && selected.filter((picked) => picked.candidate.source === VideoSource.NEW && picked.candidate.video.channelId === item.candidate.video.channelId).length >= 2) return false;
      if (item.candidate.discoveryLane && selected.filter((picked) => picked.candidate.discoveryLane?.key === item.candidate.discoveryLane?.key).length >= discoveryLaneCap) return false;
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
  const storedProfile = await db.viewerProfile.findUniqueOrThrow({ where: { userId } });
  const profile = serializeProfile(storedProfile);
  const historyRows = await db.watchHistoryItem.findMany({ where: { userId }, orderBy: { watchedAt: "desc" }, take: 5000 });
  let quotaLimited = false;
  let currentNewVideoIds = new Set<string>();
  let currentLanesByVideoId = new Map<string, DiscoveryLane[]>();
  let currentDiscoveryLanes: DiscoveryLane[] = [];
  if (request.source !== "subscribed") {
    const search = await searchNewVideos(userId, request, profile, historyRows);
    quotaLimited = search.quotaLimited;
    currentNewVideoIds = search.candidateVideoIds;
    currentLanesByVideoId = search.lanesByVideoId;
    currentDiscoveryLanes = search.lanes;
  }

  const candidateSourceFilters: Prisma.UserVideoCandidateWhereInput[] = [
    { source: VideoSource.SUBSCRIBED },
    ...(currentNewVideoIds.size ? [{ source: VideoSource.NEW, videoId: { in: [...currentNewVideoIds] } } as Prisma.UserVideoCandidateWhereInput] : [])
  ];

  const [candidateRows, likedRows, feedbackRows, activityRows, savedRows] = await Promise.all([
    db.userVideoCandidate.findMany({ where: { userId, expiresAt: { gt: new Date() }, OR: candidateSourceFilters }, include: { video: { include: { channel: true } } } }),
    db.likedVideo.findMany({ where: { userId }, include: { video: true } }),
    db.recommendationFeedback.findMany({ where: { userId }, include: { video: true } }),
    db.viewingActivity.findMany({ where: { userId, createdAt: { gt: new Date(Date.now() - 90 * 86_400_000) } }, include: { video: true } }),
    db.savedVideo.findMany({ where: { userId }, include: { video: true } })
  ]);
  const candidates: Candidate[] = candidateRows.map((row) => ({
    source: row.source,
    video: row.video,
    discoveryLane: row.source === VideoSource.NEW ? currentLanesByVideoId.get(row.videoId)?.[0] : undefined
  }));
  const requestedTopics = request.topics.length ? request.topics : [...profile.interests, ...profile.customTopics];
  const historyAnchors = profile.useWatchHistory ? historyTermsForSearch(historyRows, requestedTopics) : [];
  const likedTopics = likedRows.flatMap((row) => row.video.topics);
  const likedChannels = new Set(likedRows.map((row) => row.video.channelId));
  const openedTopics = activityRows.filter((row) => row.type === "OPENED").flatMap((row) => row.video.topics);
  const savedTopics = savedRows.flatMap((row) => row.video.topics);
  const historyChannels = new Set(historyRows.map((row) => row.channelTitle).filter((value): value is string => Boolean(value)));
  const excludedVideoIds = new Set([
    ...feedbackRows.map((row) => row.videoId),
    ...(profile.useWatchHistory ? historyRows.flatMap((row) => row.videoId ? [row.videoId] : []) : []),
    ...(options.excludedVideoIds ?? [])
  ]);
  const dislikedTopics = feedbackRows.filter((row) => row.reason === "NOT_INTERESTED").flatMap((row) => row.video.topics);
  const repeatedChannels = new Set(feedbackRows.filter((row) => row.reason === "TOO_OFTEN").map((row) => row.video.channelId));
  const tooLongUntil = Date.now() - 14 * 86_400_000;
  const avoidLong = feedbackRows.some((row) => row.reason === "TOO_LONG" && row.updatedAt.getTime() > tooLongUntil);

  const scored = candidates.flatMap((candidate) => {
    const source = candidate.source === VideoSource.SUBSCRIBED ? "subscribed" : "new";
    const video = candidate.video;
    const topics = effectiveTopics(video);
    const freshness = freshnessForVideo(video.publishedAt, request.maxAgeMonths);
    const history = profile.useWatchHistory ? historyAffinity(video, topics, historyRows, historyAnchors) : { score: 0, matched: false, anchor: null };
    if (excludedVideoIds.has(video.id)) return [];
    if (!freshness.allowed) return [];
    if (request.source !== "mixed" && request.source !== source) return [];
    if (source === "new" && !isPopularNewCreator(video.viewCount, video.likeCount)) return [];
    if (source === "new" && request.antiClickbait && isLowTrustDiscoveryTitle(video.title, video.channel.title)) return [];
    const candidateLanguage = video.language === "pl" || video.language === "en" ? video.language : null;
    if (!request.formats.includes(video.format as never) || !candidateLanguage || !request.languages.includes(candidateLanguage)) return [];
    if (request.topics.length && !overlap(topics, request.topics).length) return [];
    if (topicCategoryMismatch(video, request.topics.length ? request.topics : requestedTopics)) return [];
    if (overlap(topics, profile.excludedTopics).length) return [];
    if (request.audioFriendly && !video.audioFriendly) return [];
    if (source === "new" && currentDiscoveryLanes.length > 0 && !candidate.discoveryLane) return [];

    const topicMatches = overlap(topics, requestedTopics);
    const intentMatch = video.intents.includes(request.intent);
    const intentScore = intentMatch ? 30 : 0;
    const topicScore = topicMatches.length ? 25 : 0;
    const affinityRaw = overlap(topics, likedTopics).length * 12
      + (likedChannels.has(video.channelId) ? 28 : 0)
      + overlap(topics, openedTopics).length * 4
      + overlap(topics, savedTopics).length * 6
      + history.score
      + (candidate.discoveryLane ? 35 : 0)
      + (profile.useWatchHistory && historyChannels.has(video.channel.title) ? 4 : 0);
    const affinityScore = profile.useLikedVideos ? Math.min(20, affinityRaw / 5) : 10;
    const durationMinutes = Math.max(1, Math.ceil(video.durationSeconds / 60));
    const durationScore = durationFit(durationMinutes, request);
    const popularity = popularityScore(video, source);
    const feedbackPenalty = overlap(topics, dislikedTopics).length * 12
      + (repeatedChannels.has(video.channelId) ? 18 : 0)
      + (avoidLong && durationMinutes > 30 ? 12 : 0)
      + (request.antiClickbait ? video.clickbaitScore * 0.15 : 0);
    const match = Math.max(0, Math.min(100, Math.round(intentScore + topicScore + affinityScore + durationScore + popularity - feedbackPenalty - freshness.penalty)));
    const sourceSignal = source === "subscribed" ? "From your subscriptions" : "New creator discovery";
    const popularitySignal = source === "new" ? "Popular on YouTube" : null;
    const laneSignal = candidate.discoveryLane
      ? candidate.discoveryLane.source === "history" ? `Based on videos you watch from ${candidate.discoveryLane.label}`
        : candidate.discoveryLane.source === "subscription" ? `Based on your subscription to ${candidate.discoveryLane.label}`
          : candidate.discoveryLane.source === "liked" ? `Based on videos you liked from ${candidate.discoveryLane.label}`
            : `Based on your ${candidate.discoveryLane.label} viewing`
      : null;
    const tasteSignal = laneSignal ?? (history.matched
      ? history.anchor ? `Similar to your ${history.anchor} viewing` : "Shares specific themes with your watch history"
      : affinityRaw >= 40 ? "Strong liked-video fit" : topicMatches[0] ? `Matches your ${topicMatches[0]} interest` : null);
    const intentSignal = intentMatch ? `Fits ${request.intent}` : null;
    const signals = [sourceSignal, intentSignal ?? popularitySignal ?? freshness.signal, tasteSignal ?? popularitySignal ?? freshness.signal].filter((signal): signal is string => Boolean(signal)).slice(0, 3);
    const reason = `${freshnessReason(source, freshness.signal)}.${intentSignal ? ` ${intentSignal}.` : ""}${tasteSignal ? ` ${tasteSignal}.` : ""}`;
    return [{ candidate, match, reason, signals, durationMinutes }];
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
