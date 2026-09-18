import { createDemoSession } from "./viewerData";
import type {
  RecommendationSessionRequest,
  RecommendationSessionResponse,
  ViewerProfile,
  ViewerSignalsSummary
} from "./viewerTypes";

export const VIEWER_PROFILE_KEY = "watchflow:viewer-profile:v1";
export const VIEWER_CONNECTED_KEY = "watchflow:youtube-connected:v1";

export const defaultViewerProfile: ViewerProfile = {
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

function storageAvailable() {
  return typeof window !== "undefined" && Boolean(window.localStorage);
}

function isViewerProfile(value: unknown): value is ViewerProfile {
  if (!value || typeof value !== "object") return false;
  const profile = value as Partial<ViewerProfile>;
  return profile.version === 1
    && typeof profile.status === "string"
    && Array.isArray(profile.interests)
    && Array.isArray(profile.customTopics)
    && Array.isArray(profile.excludedTopics)
    && Array.isArray(profile.languages)
    && Array.isArray(profile.formats);
}

export async function getViewerProfile(): Promise<ViewerProfile> {
  if (!storageAvailable()) return { ...defaultViewerProfile };
  try {
    const stored = window.localStorage.getItem(VIEWER_PROFILE_KEY);
    if (!stored) return { ...defaultViewerProfile };
    const parsed: unknown = JSON.parse(stored);
    return isViewerProfile(parsed) ? { ...defaultViewerProfile, ...parsed } : { ...defaultViewerProfile };
  } catch {
    return { ...defaultViewerProfile };
  }
}

export async function saveViewerProfile(profile: ViewerProfile): Promise<ViewerProfile> {
  const normalized = { ...defaultViewerProfile, ...profile, version: 1 as const };
  if (storageAvailable()) window.localStorage.setItem(VIEWER_PROFILE_KEY, JSON.stringify(normalized));
  return normalized;
}

export function getStoredConnection() {
  return storageAvailable() && window.localStorage.getItem(VIEWER_CONNECTED_KEY) === "true";
}

export function saveStoredConnection(connected: boolean) {
  if (storageAvailable()) window.localStorage.setItem(VIEWER_CONNECTED_KEY, String(connected));
}

export async function getViewerSignals(connected: boolean, profile: ViewerProfile): Promise<ViewerSignalsSummary> {
  const pending = connected ? "Connected; live import is not active in this demo." : "Connect YouTube to make this signal available.";
  return {
    mode: "demo",
    connected,
    subscriptions: {
      state: profile.useSubscriptions ? (connected ? "pending" : "available") : "disabled",
      detail: profile.useSubscriptions ? pending : "Disabled in your taste profile."
    },
    likedVideos: {
      state: profile.useLikedVideos ? (connected ? "pending" : "available") : "disabled",
      detail: profile.useLikedVideos ? pending : "Disabled in your taste profile."
    },
    watchHistory: { state: "unavailable", detail: "YouTube does not expose watch history through the Data API." },
    watchLater: { state: "unavailable", detail: "YouTube does not expose Watch Later items through the Data API." }
  };
}

export async function createRecommendationSession(
  request: RecommendationSessionRequest,
  profile: ViewerProfile
): Promise<RecommendationSessionResponse> {
  await new Promise((resolve) => window.setTimeout(resolve, 450));
  return createDemoSession(request, profile);
}
