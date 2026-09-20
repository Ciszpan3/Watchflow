import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { freshnessForVideo, freshnessReason, searchCacheKey, youtubeSearchParameters } from "./recommendations.js";

const now = new Date("2026-09-20T12:00:00.000Z");

function monthsAgo(months: number) {
  const value = new Date(now);
  value.setUTCMonth(value.getUTCMonth() - months);
  return value;
}

describe("recommendation freshness", () => {
  it("limits YouTube discovery to the last 24 months while keeping relevance ordering", () => {
    expect(youtubeSearchParameters("science learn", "en", now)).toMatchObject({
      order: "relevance",
      publishedAfter: "2024-09-20T12:00:00.000Z"
    });
  });

  it("versions search cache keys independently from the legacy policy", () => {
    const current = searchCacheKey("science", "en", "standard");
    const legacy = createHash("sha256").update("science|en|standard").digest("hex");
    expect(current).not.toBe(legacy);
    expect(current).toBe(searchCacheKey("science", "en", "standard"));
  });

  it("rejects old discovery videos and allows a limited subscription fallback", () => {
    expect(freshnessForVideo(monthsAgo(25), "new", now).allowed).toBe(false);
    expect(freshnessForVideo(monthsAgo(25), "subscribed", now)).toMatchObject({ allowed: true, ageFallback: true, penalty: 18 });
    expect(freshnessForVideo(monthsAgo(37), "subscribed", now).allowed).toBe(false);
  });

  it("penalizes age deterministically and never calls a fallback recent", () => {
    expect(freshnessForVideo(new Date("2026-09-05T12:00:00.000Z"), "new", now).penalty).toBe(0);
    expect(freshnessForVideo(monthsAgo(8), "new", now).penalty).toBe(5);
    expect(freshnessForVideo(monthsAgo(18), "new", now).penalty).toBe(10);
    expect(freshnessReason("subscribed", true)).toContain("older fallback");
    expect(freshnessReason("subscribed", true)).not.toContain("recent");
  });
});
