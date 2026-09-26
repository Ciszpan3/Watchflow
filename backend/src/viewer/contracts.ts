export const profileStatuses = ["not_started", "in_progress", "completed", "skipped"] as const;
export const sources = ["subscribed", "mixed", "new"] as const;
export const formats = ["standard", "short", "live", "podcast"] as const;
export const languages = ["en", "pl"] as const;
export const intents = ["learn", "relax", "inspire", "company", "solve", "entertain"] as const;
export const recommendationModes = ["session", "single"] as const;
export const maxAgeMonthsOptions = [1, 3, 6, 12, 24] as const;
export const resultCountOptions = [3, 5, 10] as const;

export type ViewerProfileInput = {
  version: 2;
  status: typeof profileStatuses[number];
  interests: string[];
  customTopics: string[];
  excludedTopics: string[];
  languages: typeof languages[number][];
  formats: typeof formats[number][];
  defaultSource: typeof sources[number];
  audioFriendly: boolean;
  antiClickbait: boolean;
  useSubscriptions: boolean;
  useLikedVideos: boolean;
  useWatchHistory: boolean;
};

export type RecommendationRequest = {
  minutes: number;
  timeLimitEnabled: boolean;
  recommendationMode: typeof recommendationModes[number];
  resultCount: typeof resultCountOptions[number];
  intent: typeof intents[number];
  source: typeof sources[number];
  topics: string[];
  formats: typeof formats[number][];
  languages: typeof languages[number][];
  maxAgeMonths: typeof maxAgeMonthsOptions[number] | null;
  audioFriendly: boolean;
  antiClickbait: boolean;
};

export type WatchHistoryImportItem = {
  videoId: string | null;
  title: string;
  channelTitle: string | null;
  watchedAt: string;
};

export const defaultProfile: ViewerProfileInput = {
  version: 2,
  status: "not_started",
  interests: ["science", "design", "cooking"],
  customTopics: [],
  excludedTopics: [],
  languages: ["en", "pl"],
  formats: ["standard", "short", "live", "podcast"],
  defaultSource: "mixed",
  audioFriendly: false,
  antiClickbait: true,
  useSubscriptions: true,
  useLikedVideos: true,
  useWatchHistory: false
};

export function isProfileInput(value: unknown): value is ViewerProfileInput {
  if (!value || typeof value !== "object") return false;
  const profile = value as Partial<ViewerProfileInput>;
  return profile.version === 2
    && profileStatuses.includes(profile.status as never)
    && Array.isArray(profile.interests)
    && Array.isArray(profile.customTopics)
    && Array.isArray(profile.excludedTopics)
    && Array.isArray(profile.languages)
    && profile.languages.every((item) => languages.includes(item as never))
    && Array.isArray(profile.formats)
    && profile.formats.every((item) => formats.includes(item as never))
    && sources.includes(profile.defaultSource as never)
    && [profile.audioFriendly, profile.antiClickbait, profile.useSubscriptions, profile.useLikedVideos, profile.useWatchHistory].every((item) => typeof item === "boolean");
}

export function isRecommendationRequest(value: unknown): value is RecommendationRequest {
  if (!value || typeof value !== "object") return false;
  const request = value as Partial<RecommendationRequest>;
  return Number.isInteger(request.minutes) && Number(request.minutes) >= 5 && Number(request.minutes) <= 180
    && typeof request.timeLimitEnabled === "boolean"
    && recommendationModes.includes(request.recommendationMode as never)
    && resultCountOptions.includes(request.resultCount as never)
    && intents.includes(request.intent as never)
    && sources.includes(request.source as never)
    && Array.isArray(request.topics)
    && Array.isArray(request.formats) && request.formats.length > 0 && request.formats.every((item) => formats.includes(item as never))
    && Array.isArray(request.languages) && request.languages.length > 0 && request.languages.every((item) => languages.includes(item as never))
    && (request.maxAgeMonths === null || maxAgeMonthsOptions.includes(request.maxAgeMonths as never))
    && typeof request.audioFriendly === "boolean" && typeof request.antiClickbait === "boolean";
}

export function isWatchHistoryImportItem(value: unknown): value is WatchHistoryImportItem {
  if (!value || typeof value !== "object") return false;
  const item = value as Partial<WatchHistoryImportItem>;
  const watchedAt = item.watchedAt ? new Date(item.watchedAt) : null;
  return (item.videoId === null || typeof item.videoId === "string")
    && typeof item.title === "string" && item.title.trim().length > 0 && item.title.length <= 300
    && (item.channelTitle === null || typeof item.channelTitle === "string")
    && Boolean(watchedAt && !Number.isNaN(watchedAt.getTime()));
}
