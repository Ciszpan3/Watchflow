export const profileStatuses = ["not_started", "in_progress", "completed", "skipped"] as const;
export const sources = ["subscribed", "mixed", "new"] as const;
export const formats = ["standard", "short", "live", "podcast"] as const;
export const languages = ["en", "pl"] as const;
export const intents = ["learn", "relax", "inspire", "company", "solve", "entertain"] as const;
export const recommendationModes = ["session", "single"] as const;
export const maxAgeMonthsOptions = [1, 3, 6, 12, 24] as const;

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
};

export type RecommendationRequest = {
  minutes: number;
  timeLimitEnabled: boolean;
  recommendationMode: typeof recommendationModes[number];
  intent: typeof intents[number];
  source: typeof sources[number];
  topics: string[];
  formats: typeof formats[number][];
  languages: typeof languages[number][];
  maxAgeMonths: typeof maxAgeMonthsOptions[number] | null;
  audioFriendly: boolean;
  antiClickbait: boolean;
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
  useLikedVideos: true
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
    && [profile.audioFriendly, profile.antiClickbait, profile.useSubscriptions, profile.useLikedVideos].every((item) => typeof item === "boolean");
}

export function isRecommendationRequest(value: unknown): value is RecommendationRequest {
  if (!value || typeof value !== "object") return false;
  const request = value as Partial<RecommendationRequest>;
  return Number.isInteger(request.minutes) && Number(request.minutes) >= 5 && Number(request.minutes) <= 180
    && typeof request.timeLimitEnabled === "boolean"
    && recommendationModes.includes(request.recommendationMode as never)
    && intents.includes(request.intent as never)
    && sources.includes(request.source as never)
    && Array.isArray(request.topics)
    && Array.isArray(request.formats) && request.formats.length > 0 && request.formats.every((item) => formats.includes(item as never))
    && Array.isArray(request.languages) && request.languages.length > 0 && request.languages.every((item) => languages.includes(item as never))
    && (request.maxAgeMonths === null || maxAgeMonthsOptions.includes(request.maxAgeMonths as never))
    && typeof request.audioFriendly === "boolean" && typeof request.antiClickbait === "boolean";
}
