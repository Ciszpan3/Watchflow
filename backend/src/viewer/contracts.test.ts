import { describe, expect, it } from "vitest";
import { defaultProfile, isProfileInput, isRecommendationRequest } from "./contracts.js";

describe("viewer API contracts", () => {
  it("accepts the versioned default profile", () => {
    expect(isProfileInput(defaultProfile)).toBe(true);
  });

  it("rejects unsupported profile languages", () => {
    expect(isProfileInput({ ...defaultProfile, languages: ["de"] })).toBe(false);
  });

  it("requires finite recommendation sessions with explicit formats and languages", () => {
    const request = {
      minutes: 45,
      timeLimitEnabled: true,
      recommendationMode: "session",
      intent: "learn",
      source: "mixed",
      topics: ["science"],
      formats: ["standard"],
      languages: ["pl"],
      maxAgeMonths: 12,
      audioFriendly: false,
      antiClickbait: true
    };
    expect(isRecommendationRequest(request)).toBe(true);
    expect(isRecommendationRequest({ ...request, minutes: 240 })).toBe(false);
    expect(isRecommendationRequest({ ...request, minutes: 4 })).toBe(false);
    expect(isRecommendationRequest({ ...request, timeLimitEnabled: false })).toBe(true);
    expect(isRecommendationRequest({ ...request, recommendationMode: "feed" })).toBe(false);
    expect(isRecommendationRequest({ ...request, formats: [] })).toBe(false);
    expect(isRecommendationRequest({ ...request, maxAgeMonths: 18 })).toBe(false);
    expect(isRecommendationRequest({ ...request, maxAgeMonths: null })).toBe(true);
  });
});
