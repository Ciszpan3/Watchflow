export const profileStatuses = ["not_started", "in_progress", "completed", "skipped"] as const;
export const sources = ["subscribed", "mixed", "new"] as const;
export const formats = ["standard", "short", "live", "podcast"] as const;
export const languages = ["en", "pl"] as const;
export const intents = ["learn", "relax", "inspire", "company", "solve", "entertain"] as const;

export type ViewerProfileInput = {
  version: 1;
  status: typeof profileStatuses[number];
  interests: string[];
  customTopics: string[];
  excludedTopics: string[];
  languages: typeof languages[number][];
  formats: typeof formats[number][];
  defaultSource: typeof sources[number];
  novelty: number;
  depth: number;
  pace: number;
  audioFriendly: boolean;
  antiClickbait: boolean;
  useSubscriptions: boolean;
  useLikedVideos: boolean;
};

export type RecommendationRequest = {
  minutes: number;
  intent: typeof intents[number];
  source: typeof sources[number];
  topics: string[];
  formats: typeof formats[number][];
  languages: typeof languages[number][];
  novelty: number;
  depth: number;
  audioFriendly: boolean;
  antiClickbait: boolean;
};

export const defaultProfile: ViewerProfileInput = {
  version: 1,
  status: "not_started",
  interests: ["science", "design", "cooking"],
  customTopics: [],
  excludedTopics: [],
  languages: ["en", "pl"],
  formats: ["standard", "short", "live", "podcast"],
  defaultSource: "mixed",
  novelty: 58,
  depth: 62,
  pace: 48,
  audioFriendly: false,
  antiClickbait: true,
  useSubscriptions: true,
  useLikedVideos: true
};

export function isProfileInput(value: unknown): value is ViewerProfileInput {
  if (!value || typeof value !== "object") return false;
  const profile = value as Partial<ViewerProfileInput>;
  return profile.version === 1
    && profileStatuses.includes(profile.status as never)
    && Array.isArray(profile.interests)
    && Array.isArray(profile.customTopics)
    && Array.isArray(profile.excludedTopics)
    && Array.isArray(profile.languages)
    && profile.languages.every((item) => languages.includes(item as never))
    && Array.isArray(profile.formats)
    && profile.formats.every((item) => formats.includes(item as never))
    && sources.includes(profile.defaultSource as never)
    && [profile.novelty, profile.depth, profile.pace].every((item) => Number.isInteger(item) && Number(item) >= 0 && Number(item) <= 100)
    && [profile.audioFriendly, profile.antiClickbait, profile.useSubscriptions, profile.useLikedVideos].every((item) => typeof item === "boolean");
}

export function isRecommendationRequest(value: unknown): value is RecommendationRequest {
  if (!value || typeof value !== "object") return false;
  const request = value as Partial<RecommendationRequest>;
  return Number.isInteger(request.minutes) && Number(request.minutes) >= 5 && Number(request.minutes) <= 180
    && intents.includes(request.intent as never)
    && sources.includes(request.source as never)
    && Array.isArray(request.topics)
    && Array.isArray(request.formats) && request.formats.length > 0 && request.formats.every((item) => formats.includes(item as never))
    && Array.isArray(request.languages) && request.languages.length > 0 && request.languages.every((item) => languages.includes(item as never))
    && Number.isFinite(request.novelty) && Number.isFinite(request.depth)
    && typeof request.audioFriendly === "boolean" && typeof request.antiClickbait === "boolean";
}
