// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  VIEWER_PROFILE_KEY,
  VIEWER_PROFILE_MIGRATED_KEY,
  ViewerApiError,
  defaultViewerProfile,
  getAuthSession,
  getLiveViewerSignals,
  getQueue,
  getViewerProfile,
  getViewerSignals,
  migrateLocalProfile,
  saveToQueue,
  saveViewerProfile,
  sendFeedback
} from "./viewerApi";

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
    expect(JSON.parse(window.localStorage.getItem(VIEWER_PROFILE_KEY) ?? "{}").version).toBe(1);
  });

  it("falls back safely when stored data is invalid", async () => {
    window.localStorage.setItem(VIEWER_PROFILE_KEY, "not-json");
    await expect(getViewerProfile()).resolves.toEqual(defaultViewerProfile);
  });

  it("keeps demo signals local without inventing imported counts", async () => {
    const signals = await getViewerSignals(true, defaultViewerProfile);
    expect(signals.mode).toBe("demo");
    expect(signals.connected).toBe(false);
    expect(signals.subscriptions.state).toBe("available");
    expect(signals.likedVideos.detail).toContain("not active");
    expect(signals.watchHistory.state).toBe("unavailable");
    expect(signals.watchLater.state).toBe("unavailable");
  });

  it("uses credentialed requests for the server session", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ authenticated: false }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    await expect(getAuthSession()).resolves.toEqual({ authenticated: false });
    expect(fetchMock).toHaveBeenCalledWith("http://localhost:4000/api/auth/session", expect.objectContaining({ credentials: "include" }));
  });

  it("migrates a local profile only once when the server profile is untouched", async () => {
    const completed = { ...defaultViewerProfile, status: "completed" as const };
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ profile: completed }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    await expect(migrateLocalProfile(completed, "default")).resolves.toEqual(completed);
    await migrateLocalProfile(completed, "default");
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(window.localStorage.getItem(VIEWER_PROFILE_MIGRATED_KEY)).toBe("true");
  });

  it("sends persistent queue and feedback actions to their live endpoints", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ items: [] }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ videoId: "abc", saved: true }), { status: 201 }))
      .mockResolvedValueOnce(new Response(null, { status: 204 }));
    vi.stubGlobal("fetch", fetchMock);
    await getQueue();
    await saveToQueue("abc");
    await sendFeedback("abc", "not_interested");
    expect(fetchMock.mock.calls.map(([url]) => url)).toEqual([
      "http://localhost:4000/api/queue",
      "http://localhost:4000/api/queue",
      "http://localhost:4000/api/recommendations/abc/feedback"
    ]);
  });

  it("preserves backend error codes for reconnect and cooldown UI", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({ error: "reconnect_required", message: "Reconnect YouTube." }), { status: 401 })));
    await expect(getLiveViewerSignals()).rejects.toMatchObject<Partial<ViewerApiError>>({ status: 401, code: "reconnect_required" });
  });
});
