import { describe, expect, it } from "vitest";
import { createDemoSession, recommendations, sessionDuration } from "./viewerData";
import { defaultViewerProfile } from "./viewerApi";
import type { Recommendation, RecommendationSessionRequest } from "./viewerTypes";

const request: RecommendationSessionRequest = {
  minutes: 45,
  timeLimitEnabled: true,
  recommendationMode: "session",
  intent: "learn",
  source: "mixed",
  topics: [],
  formats: ["standard", "short", "live", "podcast"],
  languages: ["en", "pl"],
  maxAgeMonths: 12,
  audioFriendly: false,
  antiClickbait: true
};

describe("viewer recommendation sessions", () => {
  it("keeps the session finite and inside the time budget", () => {
    const result = createDemoSession(request, defaultViewerProfile);
    expect(result.items.length).toBeLessThanOrEqual(3);
    expect(result.totalMinutes).toBeLessThanOrEqual(45);
    expect(sessionDuration(result.items)).toBe(result.totalMinutes);
  });

  it("uses a subscribed-new-subscribed balance for three mixed picks", () => {
    const result = createDemoSession({ ...request, minutes: 60 }, defaultViewerProfile);
    expect(result.items.map((video) => video.source)).toEqual(["subscribed", "new", "subscribed"]);
  });

  it("does not silently expand an exclusive source", () => {
    const result = createDemoSession({ ...request, source: "new" }, defaultViewerProfile);
    expect(result.items.length).toBeGreaterThan(0);
    expect(result.items.every((video) => video.source === "new")).toBe(true);
  });

  it("treats topic, language and format as hard filters", () => {
    const result = createDemoSession({ ...request, topics: ["finance"], languages: ["pl"], formats: ["standard"] }, defaultViewerProfile);
    expect(result.items).toHaveLength(1);
    expect(result.items[0].id).toBe("finance-pl");
  });

  it("returns an empty source state when the selected pool has no candidates", () => {
    const onlyNew = recommendations.filter((video) => video.source === "new");
    const result = createDemoSession({ ...request, source: "subscribed" }, defaultViewerProfile, onlyNew);
    expect(result.items).toHaveLength(0);
    expect(result.emptyReason).toBe("no_source_matches");
  });

  it("uses liked-video affinity as a ranking signal when enabled", () => {
    const low: Recommendation = { ...recommendations[0], id: "low", channel: "Low affinity", likedAffinity: 5, source: "subscribed" };
    const high: Recommendation = { ...recommendations[0], id: "high", channel: "High affinity", likedAffinity: 100, source: "subscribed" };
    const result = createDemoSession({ ...request, source: "subscribed", minutes: 15 }, defaultViewerProfile, [low, high]);
    expect(result.items[0].id).toBe("high");
  });

  it("returns five standalone alternatives and keeps the mixed source ratio", () => {
    const result = createDemoSession({ ...request, recommendationMode: "single", minutes: 15 }, defaultViewerProfile);
    expect(result.items).toHaveLength(5);
    expect(result.items.map((video) => video.source)).toEqual(["subscribed", "new", "subscribed", "new", "subscribed"]);
    expect(result.naturalEnd).toBe(false);
  });

  it("does not use duration as a filter when the time limit is disabled", () => {
    const long = { ...recommendations[0], id: "long", duration: 120 };
    const result = createDemoSession({ ...request, source: "subscribed", minutes: 5, timeLimitEnabled: false }, defaultViewerProfile, [long]);
    expect(result.items.map((video) => video.id)).toEqual(["long"]);
  });

  it("does not repeat videos between consecutive sets", () => {
    const first = createDemoSession({ ...request, recommendationMode: "single", timeLimitEnabled: false }, defaultViewerProfile);
    const next = createDemoSession(first.request, defaultViewerProfile, recommendations, first.seenVideoIds, 2, first.chainId);
    expect(next.items.some((video) => first.seenVideoIds.includes(video.id))).toBe(false);
    expect(next.page).toBe(2);
  });

  it("treats the selected publication age as a strict filter", () => {
    const recent: Recommendation = { ...recommendations[0], id: "recent", publishedAt: new Date().toISOString() };
    const old: Recommendation = { ...recommendations[0], id: "old", publishedAt: "2020-01-01T00:00:00.000Z" };
    const limited = createDemoSession({ ...request, source: "subscribed", maxAgeMonths: 12 }, defaultViewerProfile, [old, recent]);
    const unlimited = createDemoSession({ ...request, source: "subscribed", maxAgeMonths: null }, defaultViewerProfile, [old, recent]);
    expect(limited.items.map((video) => video.id)).toEqual(["recent"]);
    expect(unlimited.items.map((video) => video.id)).toContain("old");
  });

  it("does not claim a taste-profile match without a matching signal", () => {
    const unrelated = { ...recommendations[0], id: "unrelated", topics: ["travel"], likedAffinity: 0 };
    const profile = { ...defaultViewerProfile, useLikedVideos: false, interests: ["science"] };
    const result = createDemoSession({ ...request, source: "subscribed", intent: "entertain" }, profile, [unrelated]);
    expect(result.items[0].recommendationSignals).not.toContain("Taste profile match");
  });
});
