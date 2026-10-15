import { createDemoSession } from "./viewerData";
import { apiBaseUrl } from "./api";
import type {
  AuthSession,
  RecommendationSessionRequest,
  RecommendationSessionResponse,
  ResultCount,
  QueueItem,
  QueueSort,
  ScoredRecommendation,
  LearningPath,
  ViewerActivitySummary,
  ViewerProfile,
  ViewerSignalsSummary,
  ViewerFeedbackItem,
  ViewerFeedbackReason,
  WatchHistoryImportItem,
  WatchHistorySummary
} from "./viewerTypes";

export const VIEWER_PROFILE_KEY = "watchflow:viewer-profile:v2";
const LEGACY_VIEWER_PROFILE_KEY = "watchflow:viewer-profile:v1";
export const VIEWER_PROFILE_MIGRATED_KEY = "watchflow:viewer-profile-migrated:v1";
export const VIEWER_SESSION_DRAFT_KEY = "watchflow:session-draft:v1";
export const VIEWER_LAST_SESSION_KEY = "watchflow:last-session:v1";
export const VIEWER_HISTORY_KEY = "watchflow:watch-history:v1";
export const VIEWER_FEEDBACK_KEY = "watchflow:feedback:v1";
export const VIEWER_WATCHED_KEY = "watchflow:watched-videos:v1";
export const VIEWER_PATHS_KEY = "watchflow:learning-paths:v1";

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
  useLikedVideos: true,
  useWatchHistory: false
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
    useLikedVideos: profile.useLikedVideos ?? defaultViewerProfile.useLikedVideos,
    useWatchHistory: profile.useWatchHistory ?? defaultViewerProfile.useWatchHistory
  };
}

export function normalizeSessionTopics(topics: string[] | undefined) {
  const selected = topics?.at(-1)?.trim();
  return selected ? [selected] : [];
}

function normalizeRequest(request: Partial<RecommendationSessionRequest> | undefined): RecommendationSessionRequest | null {
  if (!request) return null;
  const sortBy = request.sortBy ?? "best_match";
  return {
    ...request,
    timeLimitEnabled: request.timeLimitEnabled ?? true,
    recommendationMode: request.recommendationMode ?? "session",
    sortBy,
    resultCount: (request.resultCount ?? (request.recommendationMode === "single" ? 5 : 3)) as ResultCount,
    topics: normalizeSessionTopics(request.topics),
    maxAgeMonths: sortBy === "newest" ? 1 : request.maxAgeMonths === undefined ? 12 : request.maxAgeMonths
  } as RecommendationSessionRequest;
}

export async function getViewerProfile(): Promise<ViewerProfile> {
  if (!storageAvailable()) return { ...defaultViewerProfile };
  try {
    const stored = window.localStorage.getItem(VIEWER_PROFILE_KEY) ?? window.localStorage.getItem(LEGACY_VIEWER_PROFILE_KEY);
    if (!stored) return { ...defaultViewerProfile };
    const parsed: unknown = JSON.parse(stored);
    const normalized = normalizeProfile(parsed);
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
    watchHistory: { state: "available", count: 0, importedAt: null, detail: "Import a Google Takeout file if you want to use watch history." },
    watchLater: { state: "unavailable", detail: "YouTube does not expose Watch Later items through the Data API." }
  };
}

export async function getLiveViewerSignals() {
  return apiRequest<ViewerSignalsSummary>("/api/viewer/signals");
}

export async function getWatchHistory(mode: "demo" | "live") {
  if (mode === "live") return apiRequest<WatchHistorySummary & { items: WatchHistoryImportItem[] }>("/api/viewer/history");
  if (!storageAvailable()) return { count: 0, importedAt: null, items: [] };
  try {
    const parsed = JSON.parse(window.localStorage.getItem(VIEWER_HISTORY_KEY) ?? "null") as { items?: WatchHistoryImportItem[]; importedAt?: string } | null;
    const items = parsed?.items ?? [];
    return { count: items.length, importedAt: parsed?.importedAt ?? null, items };
  } catch {
    return { count: 0, importedAt: null, items: [] };
  }
}

export async function importWatchHistory(items: WatchHistoryImportItem[], mode: "demo" | "live") {
  if (mode === "live") return apiRequest<WatchHistorySummary>("/api/viewer/history/import", { method: "POST", body: JSON.stringify({ items }) });
  const importedAt = new Date().toISOString();
  if (storageAvailable()) window.localStorage.setItem(VIEWER_HISTORY_KEY, JSON.stringify({ items, importedAt }));
  return { count: items.length, importedAt };
}

export async function clearWatchHistory(mode: "demo" | "live") {
  if (mode === "live") return apiRequest<void>("/api/viewer/history", { method: "DELETE" });
  if (storageAvailable()) window.localStorage.removeItem(VIEWER_HISTORY_KEY);
}

export async function requestLiveSync(force = false) {
  return apiRequest<{ status: "queued" | "already_running" | "fresh"; jobId: string | null; nextAllowedAt?: string }>(`/api/viewer/sync${force ? "?force=true" : ""}`, { method: "POST" });
}

export async function createRecommendationSession(
  request: RecommendationSessionRequest,
  profile: ViewerProfile,
  mode: "demo" | "live" = "demo",
  historyItems: WatchHistoryImportItem[] = []
): Promise<RecommendationSessionResponse> {
  if (mode === "live") {
    return apiRequest<RecommendationSessionResponse>("/api/recommendations/session", { method: "POST", body: JSON.stringify(request) });
  }
  await new Promise((resolve) => window.setTimeout(resolve, 450));
  const feedback = (await getViewerFeedback("demo")).items;
  return createDemoSession(request, profile, undefined, [], 1, undefined, historyItems, feedback);
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

export async function createNextRecommendationSession(session: RecommendationSessionResponse, profile: ViewerProfile, historyItems: WatchHistoryImportItem[] = []) {
  if (session.mode === "live") {
    return apiRequest<RecommendationSessionResponse>(`/api/recommendations/session/${encodeURIComponent(session.sessionId)}/next`, { method: "POST" });
  }
  await new Promise((resolve) => window.setTimeout(resolve, 350));
  const feedback = (await getViewerFeedback("demo")).items;
  return createDemoSession(session.request, profile, undefined, session.seenVideoIds, session.page + 1, session.chainId, historyItems, feedback);
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

export async function getViewerFeedback(mode: "demo" | "live") {
  if (mode === "live") return apiRequest<{ items: ViewerFeedbackItem[] }>("/api/viewer/feedback");
  if (!storageAvailable()) return { items: [] };
  try {
    const items = JSON.parse(window.localStorage.getItem(VIEWER_FEEDBACK_KEY) ?? "[]") as ViewerFeedbackItem[];
    return { items: Array.isArray(items) ? items : [] };
  } catch {
    return { items: [] };
  }
}

export async function sendFeedback(video: ScoredRecommendation, reason: ViewerFeedbackReason, topic: string | undefined, mode: "demo" | "live") {
  if (mode === "live") {
    return apiRequest<{ feedback: ViewerFeedbackItem }>(`/api/recommendations/${encodeURIComponent(video.id)}/feedback`, {
      method: "POST",
      body: JSON.stringify({ reason, topic })
    });
  }
  const now = new Date();
  const expires = ["less_topic", "too_long", "too_often"].includes(reason)
    ? new Date(now.getTime() + 30 * 86_400_000).toISOString()
    : null;
  const feedback: ViewerFeedbackItem = {
    videoId: video.id,
    reason,
    targetTopics: reason === "less_topic" && topic ? [topic] : [],
    createdAt: now.toISOString(),
    updatedAt: now.toISOString(),
    preferenceExpiresAt: expires,
    video: { title: video.title, channel: video.channel, image: video.image, duration: video.duration }
  };
  const current = (await getViewerFeedback("demo")).items.filter((item) => item.videoId !== video.id);
  if (storageAvailable()) window.localStorage.setItem(VIEWER_FEEDBACK_KEY, JSON.stringify([feedback, ...current]));
  return { feedback };
}

export async function removeFeedback(videoId: string, mode: "demo" | "live") {
  if (mode === "live") return apiRequest<void>(`/api/recommendations/${encodeURIComponent(videoId)}/feedback`, { method: "DELETE" });
  const current = (await getViewerFeedback("demo")).items.filter((item) => item.videoId !== videoId);
  if (storageAvailable()) window.localStorage.setItem(VIEWER_FEEDBACK_KEY, JSON.stringify(current));
}

export async function clearViewerFeedback(mode: "demo" | "live") {
  if (mode === "live") return apiRequest<void>("/api/viewer/feedback", { method: "DELETE" });
  if (storageAvailable()) window.localStorage.removeItem(VIEWER_FEEDBACK_KEY);
}

type DemoWatchedVideo = { video: ScoredRecommendation; watchedAt: string };

function readDemoWatched(): DemoWatchedVideo[] {
  if (!storageAvailable()) return [];
  try {
    const parsed = JSON.parse(window.localStorage.getItem(VIEWER_WATCHED_KEY) ?? "[]") as DemoWatchedVideo[];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function readDemoPaths(): LearningPath[] {
  if (!storageAvailable()) return [];
  try {
    const parsed = JSON.parse(window.localStorage.getItem(VIEWER_PATHS_KEY) ?? "[]") as LearningPath[];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function demoId(prefix: string) {
  return `${prefix}-${typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(16).slice(2)}`}`;
}

function buildDemoDiet(entries: DemoWatchedVideo[]): ViewerActivitySummary["diet"] {
  const periodDays = 7;
  const periodStart = new Date(Date.now() - periodDays * 86_400_000);
  const recent = entries.filter((entry) => new Date(entry.watchedAt) >= periodStart);
  const labels: Record<string, string> = {
    learn: "Learning", relax: "Relaxation", inspire: "Inspiration",
    company: "Company", solve: "Practical", entertain: "Entertainment"
  };
  const categories = new Map<string, number>();
  const topics = new Map<string, number>();
  for (const entry of recent) {
    const category = entry.video.intents[0] ?? "entertain";
    categories.set(category, (categories.get(category) ?? 0) + 1);
    for (const topic of entry.video.topics) topics.set(topic, (topics.get(topic) ?? 0) + 1);
  }
  return {
    periodDays,
    periodStart: periodStart.toISOString(),
    watchedCount: recent.length,
    totalMinutes: recent.reduce((sum, entry) => sum + entry.video.duration, 0),
    uniqueChannels: new Set(recent.map((entry) => entry.video.channel)).size,
    categories: [...categories.entries()].sort((left, right) => right[1] - left[1]).map(([key, count]) => ({
      key, label: labels[key] ?? key, count, percentage: recent.length ? Math.round((count / recent.length) * 100) : 0
    })),
    topTopics: [...topics.entries()].sort((left, right) => right[1] - left[1]).slice(0, 4).map(([topic, count]) => ({ topic, count })),
    sources: {
      subscribed: recent.filter((entry) => entry.video.source === "subscribed").length,
      new: recent.filter((entry) => entry.video.source === "new").length
    }
  };
}

function syncDemoPathWatched(paths: LearningPath[], watched: DemoWatchedVideo[]) {
  const watchedMap = new Map(watched.map((entry) => [entry.video.id, entry.watchedAt]));
  return paths.map((path) => ({
    ...path,
    items: path.items.map((item) => ({
      ...item,
      watched: watchedMap.has(item.video.id),
      watchedAt: watchedMap.get(item.video.id) ?? null
    }))
  }));
}

export async function getViewerActivity(mode: "demo" | "live") {
  if (mode === "live") return apiRequest<ViewerActivitySummary>("/api/activity");
  const entries = readDemoWatched();
  return { watchedVideoIds: entries.map((entry) => entry.video.id), diet: buildDemoDiet(entries) };
}

export async function markVideoWatched(video: ScoredRecommendation, mode: "demo" | "live") {
  if (mode === "live") return apiRequest<{ videoId: string; watched: true; watchedAt: string }>(`/api/activity/watched/${encodeURIComponent(video.id)}`, { method: "PUT" });
  const watchedAt = new Date().toISOString();
  const entries = readDemoWatched().filter((entry) => entry.video.id !== video.id);
  if (storageAvailable()) window.localStorage.setItem(VIEWER_WATCHED_KEY, JSON.stringify([{ video, watchedAt }, ...entries]));
  return { videoId: video.id, watched: true as const, watchedAt };
}

export async function unmarkVideoWatched(videoId: string, mode: "demo" | "live") {
  if (mode === "live") return apiRequest<void>(`/api/activity/watched/${encodeURIComponent(videoId)}`, { method: "DELETE" });
  if (storageAvailable()) window.localStorage.setItem(VIEWER_WATCHED_KEY, JSON.stringify(readDemoWatched().filter((entry) => entry.video.id !== videoId)));
}

export async function getLearningPaths(mode: "demo" | "live") {
  if (mode === "live") return apiRequest<{ items: LearningPath[] }>("/api/learning-paths");
  return { items: syncDemoPathWatched(readDemoPaths(), readDemoWatched()) };
}

export async function createLearningPath(title: string, topic: string, mode: "demo" | "live") {
  if (mode === "live") return apiRequest<{ path: LearningPath }>("/api/learning-paths", { method: "POST", body: JSON.stringify({ title, topic: topic || null }) });
  const now = new Date().toISOString();
  const path: LearningPath = { id: demoId("path"), title: title.trim(), topic: topic || null, createdAt: now, updatedAt: now, items: [] };
  const paths = [path, ...readDemoPaths()];
  if (storageAvailable()) window.localStorage.setItem(VIEWER_PATHS_KEY, JSON.stringify(paths));
  return { path };
}

export async function deleteLearningPath(pathId: string, mode: "demo" | "live") {
  if (mode === "live") return apiRequest<void>(`/api/learning-paths/${encodeURIComponent(pathId)}`, { method: "DELETE" });
  if (storageAvailable()) window.localStorage.setItem(VIEWER_PATHS_KEY, JSON.stringify(readDemoPaths().filter((path) => path.id !== pathId)));
}

export async function addVideoToLearningPath(pathId: string, video: ScoredRecommendation, mode: "demo" | "live") {
  if (mode === "live") return apiRequest<{ path: LearningPath }>(`/api/learning-paths/${encodeURIComponent(pathId)}/items`, { method: "POST", body: JSON.stringify({ videoId: video.id }) });
  const paths = readDemoPaths();
  const next = paths.map((path) => path.id !== pathId || path.items.some((item) => item.video.id === video.id) ? path : {
    ...path,
    updatedAt: new Date().toISOString(),
    items: [...path.items, { id: demoId("path-item"), position: path.items.length, addedAt: new Date().toISOString(), watched: false, watchedAt: null, video }]
  });
  if (storageAvailable()) window.localStorage.setItem(VIEWER_PATHS_KEY, JSON.stringify(next));
  return { path: syncDemoPathWatched(next, readDemoWatched()).find((path) => path.id === pathId)! };
}

export async function removeVideoFromLearningPath(pathId: string, videoId: string, mode: "demo" | "live") {
  if (mode === "live") return apiRequest<void>(`/api/learning-paths/${encodeURIComponent(pathId)}/items/${encodeURIComponent(videoId)}`, { method: "DELETE" });
  const paths = readDemoPaths().map((path) => path.id !== pathId ? path : {
    ...path,
    updatedAt: new Date().toISOString(),
    items: path.items.filter((item) => item.video.id !== videoId).map((item, position) => ({ ...item, position }))
  });
  if (storageAvailable()) window.localStorage.setItem(VIEWER_PATHS_KEY, JSON.stringify(paths));
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
