// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  VIEWER_PROFILE_KEY,
  VIEWER_PROFILE_MIGRATED_KEY,
  VIEWER_LAST_SESSION_KEY,
  VIEWER_SESSION_DRAFT_KEY,
  VIEWER_WATCHED_KEY,
  VIEWER_PATHS_KEY,
  ViewerApiError,
  defaultViewerProfile,
  getAuthSession,
  getLiveViewerSignals,
  getLatestRecommendationSession,
  getQueue,
  getViewerFeedback,
  getViewerProfile,
  getViewerSignals,
  getSessionDraft,
  migrateLocalProfile,
  normalizeSessionTopics,
  saveToQueue,
  saveLatestRecommendationSession,
  saveSessionDraft,
  saveViewerProfile,
  sendFeedback,
  removeFeedback,
  clearViewerFeedback,
  getViewerActivity,
  markVideoWatched,
  unmarkVideoWatched,
  getLearningPaths,
  createLearningPath,
  deleteLearningPath,
  addVideoToLearningPath,
  removeVideoFromLearningPath
} from "./viewerApi";
import { createDemoSession, recommendations } from "./viewerData";
import type { RecommendationSessionRequest } from "./viewerTypes";

const request: RecommendationSessionRequest = {
  minutes: 30,
  timeLimitEnabled: false,
  recommendationMode: "single",
  sortBy: "best_match",
  resultCount: 5,
  intent: "relax",
  source: "mixed",
  topics: [],
  formats: ["standard"],
  languages: ["en"],
  maxAgeMonths: 12,
  audioFriendly: false,
  antiClickbait: true
};

describe("viewer profile adapter", () => {
  beforeEach(() => window.localStorage.clear());
  afterEach(() => vi.unstubAllGlobals());

  it("returns versioned defaults when no profile exists", async () => {
    await expect(getViewerProfile()).resolves.toEqual(defaultViewerProfile);
  });

  it("persists onboarding progress and completed preferences", async () => {
    const profile = { ...defaultViewerProfile, status: "completed" as const, interests: ["science", "history", "design"] };
    await saveViewerProfile(profile);
    await expect(getViewerProfile()).resolves.toMatchObject(profile);
    expect(JSON.parse(window.localStorage.getItem(VIEWER_PROFILE_KEY) ?? "{}").version).toBe(2);
  });

  it("converts a legacy local profile to v2 without losing useful preferences", async () => {
    window.localStorage.setItem("watchflow:viewer-profile:v1", JSON.stringify({
      ...defaultViewerProfile,
      version: 1,
      interests: ["gaming", "technology"],
      novelty: 90,
      depth: 20,
      pace: 75
    }));
    const profile = await getViewerProfile();
    expect(profile).toMatchObject({ version: 2, interests: ["gaming", "technology"] });
    expect(profile).not.toHaveProperty("novelty");
  });

  it("falls back safely when stored data is invalid", async () => {
    window.localStorage.setItem(VIEWER_PROFILE_KEY, "not-json");
    await expect(getViewerProfile()).resolves.toEqual(defaultViewerProfile);
  });

  it("persists the demo session draft and latest results", async () => {
    await saveSessionDraft(request, "demo");
    const session = createDemoSession(request, defaultViewerProfile);
    saveLatestRecommendationSession(session);

    await expect(getSessionDraft("demo")).resolves.toMatchObject({ request });
    await expect(getLatestRecommendationSession("demo")).resolves.toMatchObject({ session: { sessionId: session.sessionId, request } });
    expect(window.localStorage.getItem(VIEWER_SESSION_DRAFT_KEY)).toBeTruthy();
    expect(window.localStorage.getItem(VIEWER_LAST_SESSION_KEY)).toBeTruthy();
  });

  it("migrates accumulated session topics to one explicit topic", async () => {
    expect(normalizeSessionTopics(["gaming", "technology", "science"])).toEqual(["science"]);
    window.localStorage.setItem(VIEWER_SESSION_DRAFT_KEY, JSON.stringify({ request: { ...request, topics: ["gaming", "technology"] } }));
    await expect(getSessionDraft("demo")).resolves.toMatchObject({ request: { topics: ["technology"] } });
  });

  it("normalizes older saved sessions to best-match ordering", async () => {
    const { sortBy: _sortBy, ...legacyRequest } = request;
    window.localStorage.setItem(VIEWER_SESSION_DRAFT_KEY, JSON.stringify({ request: legacyRequest }));
    await expect(getSessionDraft("demo")).resolves.toMatchObject({ request: { sortBy: "best_match" } });
  });

  it("normalizes an older unlimited newest draft to the last 30 days", async () => {
    window.localStorage.setItem(VIEWER_SESSION_DRAFT_KEY, JSON.stringify({
      request: { ...request, sortBy: "newest", maxAgeMonths: null }
    }));
    await expect(getSessionDraft("demo")).resolves.toMatchObject({
      request: { sortBy: "newest", maxAgeMonths: 1 }
    });
  });

  it("keeps demo signals local without inventing imported counts", async () => {
    const signals = await getViewerSignals(true, defaultViewerProfile);
    expect(signals.mode).toBe("demo");
    expect(signals.connected).toBe(false);
    expect(signals.subscriptions.state).toBe("available");
    expect(signals.likedVideos.detail).toContain("not active");
    expect(signals.watchHistory.state).toBe("available");
    expect(signals.watchLater.state).toBe("unavailable");
  });

  it("uses credentialed requests for the server session", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ authenticated: false }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    await expect(getAuthSession()).resolves.toEqual({ authenticated: false });
    expect(fetchMock).toHaveBeenCalledWith("http://localhost:4000/api/auth/session", expect.objectContaining({ credentials: "include" }));
  });

  it("migrates a local profile only once when the server profile is untouched", async () => {
    const localProfile = { ...defaultViewerProfile, status: "completed" as const, interests: ["gaming", "health", "technology"] };
    const serverProfile = { ...defaultViewerProfile, status: "not_started" as const };
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ profile: localProfile }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    await expect(migrateLocalProfile(localProfile, serverProfile, "default")).resolves.toEqual(localProfile);
    await expect(migrateLocalProfile(defaultViewerProfile, localProfile, "default")).resolves.toEqual(localProfile);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(window.localStorage.getItem(VIEWER_PROFILE_MIGRATED_KEY)).toBe("true");
  });

  it("always keeps an existing server profile as the live source of truth", async () => {
    const localProfile = { ...defaultViewerProfile, interests: ["science", "design", "cooking"] };
    const serverProfile = { ...defaultViewerProfile, status: "completed" as const, interests: ["gaming", "health", "technology"] };
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    await expect(migrateLocalProfile(localProfile, serverProfile, "persisted")).resolves.toEqual(serverProfile);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("sends persistent queue and feedback actions to their live endpoints", async () => {
    const video = { ...recommendations[0], fit: "strong" as const, reason: "Fits.", recommendationSignals: ["Subscribed"] };
    const feedback = {
      videoId: video.id,
      reason: "not_for_me" as const,
      targetTopics: [],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      preferenceExpiresAt: null,
      video: { title: video.title, channel: video.channel, image: video.image, duration: video.duration }
    };
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ items: [] }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ videoId: "abc", saved: true }), { status: 201 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ feedback }), { status: 201 }));
    vi.stubGlobal("fetch", fetchMock);
    await getQueue();
    await saveToQueue("abc");
    await sendFeedback(video, "not_for_me", undefined, "live");
    expect(fetchMock.mock.calls.map(([url]) => url)).toEqual([
      "http://localhost:4000/api/queue?sort=saved_newest",
      "http://localhost:4000/api/queue",
      `http://localhost:4000/api/recommendations/${video.id}/feedback`
    ]);
  });

  it("persists, removes and clears reversible demo feedback", async () => {
    const video = { ...recommendations[0], fit: "strong" as const, reason: "Fits.", recommendationSignals: ["Subscribed"] };
    await sendFeedback(video, "less_topic", "science", "demo");
    await expect(getViewerFeedback("demo")).resolves.toMatchObject({
      items: [{ videoId: video.id, reason: "less_topic", targetTopics: ["science"] }]
    });
    await removeFeedback(video.id, "demo");
    await expect(getViewerFeedback("demo")).resolves.toEqual({ items: [] });
    await sendFeedback(video, "too_often", undefined, "demo");
    await clearViewerFeedback("demo");
    await expect(getViewerFeedback("demo")).resolves.toEqual({ items: [] });
  });

  it("counts only videos explicitly marked as watched in the demo content diet", async () => {
    const video = { ...recommendations[0], fit: "strong" as const, reason: "Fits.", recommendationSignals: ["Subscribed"] };
    await markVideoWatched(video, "demo");
    await expect(getViewerActivity("demo")).resolves.toMatchObject({
      watchedVideoIds: [video.id],
      diet: { watchedCount: 1, totalMinutes: video.duration }
    });
    expect(window.localStorage.getItem(VIEWER_WATCHED_KEY)).toBeTruthy();
    await unmarkVideoWatched(video.id, "demo");
    await expect(getViewerActivity("demo")).resolves.toMatchObject({ watchedVideoIds: [], diet: { watchedCount: 0 } });
  });

  it("persists manually created demo paths and never adds a video without an explicit action", async () => {
    const video = { ...recommendations[0], fit: "strong" as const, reason: "Fits.", recommendationSignals: ["Subscribed"] };
    const created = await createLearningPath("Learn astronomy", "science", "demo");
    await expect(getLearningPaths("demo")).resolves.toMatchObject({ items: [{ id: created.path.id, items: [] }] });
    await addVideoToLearningPath(created.path.id, video, "demo");
    await expect(getLearningPaths("demo")).resolves.toMatchObject({ items: [{ items: [{ video: { id: video.id }, watched: false }] }] });
    await markVideoWatched(video, "demo");
    await expect(getLearningPaths("demo")).resolves.toMatchObject({ items: [{ items: [{ watched: true }] }] });
    await removeVideoFromLearningPath(created.path.id, video.id, "demo");
    await expect(getLearningPaths("demo")).resolves.toMatchObject({ items: [{ items: [] }] });
    await deleteLearningPath(created.path.id, "demo");
    await expect(getLearningPaths("demo")).resolves.toEqual({ items: [] });
    expect(window.localStorage.getItem(VIEWER_PATHS_KEY)).toBe("[]");
  });

  it("uses the live activity and learning path endpoints", async () => {
    const video = { ...recommendations[0], fit: "strong" as const, reason: "Fits.", recommendationSignals: ["Subscribed"] };
    const path = { id: "path-1", title: "Science", topic: "science", createdAt: "2026-10-15T00:00:00.000Z", updatedAt: "2026-10-15T00:00:00.000Z", items: [] };
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ watchedVideoIds: [], diet: { watchedCount: 0 } }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ videoId: video.id, watched: true, watchedAt: "2026-10-15T00:00:00.000Z" }), { status: 200 }))
      .mockResolvedValueOnce(new Response(null, { status: 204 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ items: [] }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ path }), { status: 201 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ path }), { status: 200 }))
      .mockResolvedValueOnce(new Response(null, { status: 204 }))
      .mockResolvedValueOnce(new Response(null, { status: 204 }));
    vi.stubGlobal("fetch", fetchMock);
    await getViewerActivity("live");
    await markVideoWatched(video, "live");
    await unmarkVideoWatched(video.id, "live");
    await getLearningPaths("live");
    await createLearningPath("Science", "science", "live");
    await addVideoToLearningPath(path.id, video, "live");
    await removeVideoFromLearningPath(path.id, video.id, "live");
    await deleteLearningPath(path.id, "live");
    expect(fetchMock.mock.calls.map(([url]) => url)).toEqual([
      "http://localhost:4000/api/activity",
      `http://localhost:4000/api/activity/watched/${video.id}`,
      `http://localhost:4000/api/activity/watched/${video.id}`,
      "http://localhost:4000/api/learning-paths",
      "http://localhost:4000/api/learning-paths",
      `http://localhost:4000/api/learning-paths/${path.id}/items`,
      `http://localhost:4000/api/learning-paths/${path.id}/items/${video.id}`,
      `http://localhost:4000/api/learning-paths/${path.id}`
    ]);
  });

  it("preserves backend error codes for reconnect and cooldown UI", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({ error: "reconnect_required", message: "Reconnect YouTube." }), { status: 401 })));
    await expect(getLiveViewerSignals()).rejects.toMatchObject<Partial<ViewerApiError>>({ status: 401, code: "reconnect_required" });
  });
});
