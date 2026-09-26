import { createDemoSession } from "./viewerData";
import { apiBaseUrl } from "./api";
import type {
  AuthSession,
  RecommendationSessionRequest,
  RecommendationSessionResponse,
  QueueItem,
  QueueSort,
  ScoredRecommendation,
  ViewerProfile,
  ViewerSignalsSummary
} from "./viewerTypes";

export const VIEWER_PROFILE_KEY = "watchflow:viewer-profile:v2";
const LEGACY_VIEWER_PROFILE_KEY = "watchflow:viewer-profile:v1";
export const VIEWER_PROFILE_MIGRATED_KEY = "watchflow:viewer-profile-migrated:v1";
export const VIEWER_SESSION_DRAFT_KEY = "watchflow:session-draft:v1";
export const VIEWER_LAST_SESSION_KEY = "watchflow:last-session:v1";

export const defaultViewerProfile: ViewerProfile = {
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

function storageAvailable() {
  return typeof window !== "undefined" && Boolean(window.localStorage);
}

function isViewerProfile(value: unknown): value is ViewerProfile {
  if (!value || typeof value !== "object") return false;
  const profile = value as Partial<ViewerProfile>;
  return profile.version === 2
    && typeof profile.status === "string"
    && Array.isArray(profile.interests)
    && Array.isArray(profile.customTopics)
    && Array.isArray(profile.excludedTopics)
    && Array.isArray(profile.languages)
    && Array.isArray(profile.formats);
}

function normalizeProfile(value: unknown): ViewerProfile | null {
  if (!value || typeof value !== "object") return null;
  const profile = value as Partial<ViewerProfile> & { version?: number };
  if (![1, 2].includes(profile.version ?? 0)
    || typeof profile.status !== "string"
    || !Array.isArray(profile.interests)
    || !Array.isArray(profile.customTopics)
    || !Array.isArray(profile.excludedTopics)
    || !Array.isArray(profile.languages)
    || !Array.isArray(profile.formats)) return null;
  return {
    version: 2,
    status: profile.status as ViewerProfile["status"],
    interests: profile.interests,
    customTopics: profile.customTopics,
    excludedTopics: profile.excludedTopics,
    languages: profile.languages as ViewerProfile["languages"],
    formats: profile.formats as ViewerProfile["formats"],
    defaultSource: profile.defaultSource ?? defaultViewerProfile.defaultSource,
    audioFriendly: profile.audioFriendly ?? defaultViewerProfile.audioFriendly,
    antiClickbait: profile.antiClickbait ?? defaultViewerProfile.antiClickbait,
    useSubscriptions: profile.useSubscriptions ?? defaultViewerProfile.useSubscriptions,
    useLikedVideos: profile.useLikedVideos ?? defaultViewerProfile.useLikedVideos
  };
}

function normalizeRequest(request: Partial<RecommendationSessionRequest> | undefined): RecommendationSessionRequest | null {
  if (!request) return null;
  return {
    ...request,
    timeLimitEnabled: request.timeLimitEnabled ?? true,
    recommendationMode: request.recommendationMode ?? "session",
    maxAgeMonths: request.maxAgeMonths === undefined ? 12 : request.maxAgeMonths
  } as RecommendationSessionRequest;
}

export async function getViewerProfile(): Promise<ViewerProfile> {
  if (!storageAvailable()) return { ...defaultViewerProfile };
  try {
    const stored = window.localStorage.getItem(VIEWER_PROFILE_KEY) ?? window.localStorage.getItem(LEGACY_VIEWER_PROFILE_KEY);
    if (!stored) return { ...defaultViewerProfile };
    const parsed: unknown = JSON.parse(stored);
    const normalized = isViewerProfile(parsed) ? parsed : normalizeProfile(parsed);
    if (normalized) window.localStorage.setItem(VIEWER_PROFILE_KEY, JSON.stringify(normalized));
    return normalized ?? { ...defaultViewerProfile };
  } catch {
    return { ...defaultViewerProfile };
  }
}

export async function saveViewerProfile(profile: ViewerProfile): Promise<ViewerProfile> {
  const normalized = { ...defaultViewerProfile, ...profile, version: 2 as const };
  if (storageAvailable()) window.localStorage.setItem(VIEWER_PROFILE_KEY, JSON.stringify(normalized));
  return normalized;
}

export class ViewerApiError extends Error {
  constructor(public status: number, public code: string, message: string, public details?: Record<string, unknown>) {
    super(message);
  }
}

async function apiRequest<T>(path: string, init: RequestInit = {}): Promise<T> {
  const response = await fetch(`${apiBaseUrl}${path}`, {
    ...init,
    credentials: "include",
    headers: init.body ? { "Content-Type": "application/json", ...init.headers } : init.headers
  });
  if (!response.ok) {
    const body = await response.json().catch(() => ({})) as { error?: string; message?: string } & Record<string, unknown>;
    throw new ViewerApiError(response.status, body.error ?? "request_failed", body.message ?? `Request failed with status ${response.status}.`, body);
  }
  if (response.status === 204) return undefined as T;
  return response.json() as Promise<T>;
}

export async function getAuthSession() {
  return apiRequest<AuthSession>("/api/auth/session");
}

export async function getLiveViewerProfile() {
  return apiRequest<{ profile: ViewerProfile; source: "default" | "persisted" }>("/api/viewer/profile");
}

export async function saveLiveViewerProfile(profile: ViewerProfile) {
  const response = await apiRequest<{ profile: ViewerProfile }>("/api/viewer/profile", { method: "PUT", body: JSON.stringify(profile) });
  return response.profile;
}

export async function migrateLocalProfile(localProfile: ViewerProfile, serverProfile: ViewerProfile, source: "default" | "persisted") {
  if (!storageAvailable() || source !== "default" || window.localStorage.getItem(VIEWER_PROFILE_MIGRATED_KEY) === "true") return serverProfile;
  const migrated = await saveLiveViewerProfile(localProfile);
  window.localStorage.setItem(VIEWER_PROFILE_MIGRATED_KEY, "true");
  return migrated;
}

export async function getViewerSignals(_connected: boolean, profile: ViewerProfile): Promise<ViewerSignalsSummary> {
  const pending = "Live import is not active in demo mode. Connect YouTube to use this signal.";
  return {
    mode: "demo",
    connected: false,
    subscriptions: {
      state: profile.useSubscriptions ? "available" : "disabled",
      detail: profile.useSubscriptions ? pending : "Disabled in your taste profile."
    },
    likedVideos: {
      state: profile.useLikedVideos ? "available" : "disabled",
      detail: profile.useLikedVideos ? pending : "Disabled in your taste profile."
    },
    watchHistory: { state: "unavailable", detail: "YouTube does not expose watch history through the Data API." },
    watchLater: { state: "unavailable", detail: "YouTube does not expose Watch Later items through the Data API." }
  };
}

export async function getLiveViewerSignals() {
  return apiRequest<ViewerSignalsSummary>("/api/viewer/signals");
}

export async function requestLiveSync(force = false) {
  return apiRequest<{ status: "queued" | "already_running" | "fresh"; jobId: string | null; nextAllowedAt?: string }>(`/api/viewer/sync${force ? "?force=true" : ""}`, { method: "POST" });
}

export async function createRecommendationSession(
  request: RecommendationSessionRequest,
  profile: ViewerProfile,
  mode: "demo" | "live" = "demo"
): Promise<RecommendationSessionResponse> {
  if (mode === "live") {
    return apiRequest<RecommendationSessionResponse>("/api/recommendations/session", { method: "POST", body: JSON.stringify(request) });
  }
  await new Promise((resolve) => window.setTimeout(resolve, 450));
  return createDemoSession(request, profile);
}

export async function getSessionDraft(mode: "demo" | "live") {
  if (mode === "live") {
    const result = await apiRequest<{ request: RecommendationSessionRequest | null; updatedAt: string | null }>("/api/viewer/session-draft");
    return { ...result, request: normalizeRequest(result.request ?? undefined) };
  }
  if (!storageAvailable()) return { request: null, updatedAt: null };
  try {
    const stored = window.localStorage.getItem(VIEWER_SESSION_DRAFT_KEY);
    if (!stored) return { request: null, updatedAt: null };
    const parsed = JSON.parse(stored) as { request?: Partial<RecommendationSessionRequest>; updatedAt?: string };
    return { request: normalizeRequest(parsed.request), updatedAt: parsed.updatedAt ?? null };
  } catch {
    return { request: null, updatedAt: null };
  }
}

export async function saveSessionDraft(request: RecommendationSessionRequest, mode: "demo" | "live") {
  if (mode === "live") return apiRequest<{ request: RecommendationSessionRequest; updatedAt: string }>("/api/viewer/session-draft", { method: "PUT", body: JSON.stringify(request) });
  const value = { request, updatedAt: new Date().toISOString() };
  if (storageAvailable()) window.localStorage.setItem(VIEWER_SESSION_DRAFT_KEY, JSON.stringify(value));
  return value;
}

export async function getLatestRecommendationSession(mode: "demo" | "live") {
  if (mode === "live") return apiRequest<{ session: RecommendationSessionResponse | null }>("/api/recommendations/session/latest");
  if (!storageAvailable()) return { session: null };
  try {
    const stored = window.localStorage.getItem(VIEWER_LAST_SESSION_KEY);
    if (!stored) return { session: null };
    const parsed = JSON.parse(stored) as RecommendationSessionResponse;
    const request = normalizeRequest(parsed.request);
    if (!request) return { session: null };
    return { session: {
      ...parsed,
      chainId: parsed.chainId ?? `demo-chain-${Date.now()}`,
      page: parsed.page ?? 1,
      request,
      recommendationMode: parsed.recommendationMode ?? request.recommendationMode,
      naturalEnd: (parsed.recommendationMode ?? request.recommendationMode) === "session",
      hasMore: parsed.hasMore ?? true,
      seenVideoIds: parsed.seenVideoIds ?? parsed.items.map((item) => item.id)
    } };
  } catch {
    return { session: null };
  }
}

export function saveLatestRecommendationSession(session: RecommendationSessionResponse) {
  if (storageAvailable() && session.mode === "demo") window.localStorage.setItem(VIEWER_LAST_SESSION_KEY, JSON.stringify(session));
}

export async function createNextRecommendationSession(session: RecommendationSessionResponse, profile: ViewerProfile) {
  if (session.mode === "live") {
    return apiRequest<RecommendationSessionResponse>(`/api/recommendations/session/${encodeURIComponent(session.sessionId)}/next`, { method: "POST" });
  }
  await new Promise((resolve) => window.setTimeout(resolve, 350));
  return createDemoSession(session.request, profile, undefined, session.seenVideoIds, session.page + 1, session.chainId);
}

export async function getQueue(sort: QueueSort = "saved_newest") {
  return apiRequest<{ items: QueueItem[] }>(`/api/queue?sort=${encodeURIComponent(sort)}`);
}

export async function saveToQueue(videoId: string) {
  return apiRequest<{ videoId: string; saved: true }>("/api/queue", { method: "POST", body: JSON.stringify({ videoId }) });
}

export async function removeFromQueue(videoId: string) {
  return apiRequest<void>(`/api/queue/${encodeURIComponent(videoId)}`, { method: "DELETE" });
}

export async function sendFeedback(videoId: string, reason: "already_watched" | "not_interested" | "too_long" | "too_often") {
  return apiRequest<void>(`/api/recommendations/${encodeURIComponent(videoId)}/feedback`, { method: "POST", body: JSON.stringify({ reason }) });
}

export async function recordOpened(videoId: string) {
  return apiRequest<void>(`/api/recommendations/${encodeURIComponent(videoId)}/opened`, { method: "POST" });
}

export async function logout() {
  return apiRequest<void>("/api/auth/logout", { method: "POST" });
}

export async function disconnectYoutube() {
  return apiRequest<void>("/api/auth/youtube", { method: "DELETE" });
}

export async function deleteViewerAccount() {
  return apiRequest<void>("/api/viewer/account", { method: "DELETE" });
}
