// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from "vitest";
import { VIEWER_PROFILE_KEY, defaultViewerProfile, getViewerProfile, getViewerSignals, saveViewerProfile } from "./viewerApi";

describe("viewer profile adapter", () => {
  beforeEach(() => window.localStorage.clear());

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

  it("labels supported signals as pending without inventing import counts", async () => {
    const signals = await getViewerSignals(true, defaultViewerProfile);
    expect(signals.subscriptions.state).toBe("pending");
    expect(signals.likedVideos.detail).toContain("not active");
    expect(signals.watchHistory.state).toBe("unavailable");
    expect(signals.watchLater.state).toBe("unavailable");
  });
});
