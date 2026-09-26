import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { fitTier, freshnessForVideo, freshnessReason, searchCacheKey, youtubeSearchParameters } from "./recommendations.js";

const now = new Date("2026-09-20T12:00:00.000Z");

function monthsAgo(months: number) {
  const value = new Date(now);
  value.setUTCMonth(value.getUTCMonth() - months);
  return value;
}

describe("recommendation freshness", () => {
  it("uses the selected age limit while keeping relevance ordering", () => {
    expect(youtubeSearchParameters("science learn", "en", 24, now)).toMatchObject({
      order: "relevance",
      publishedAfter: "2024-09-20T12:00:00.000Z"
    });
    expect(youtubeSearchParameters("science learn", "en", null, now)).not.toHaveProperty("publishedAfter");
  });

  it("versions search cache keys independently from the legacy policy", () => {
    const current = searchCacheKey("science", "en", "standard", 12);
    const legacy = createHash("sha256").update("science|en|standard").digest("hex");
    expect(current).not.toBe(legacy);
    expect(current).not.toBe(searchCacheKey("science", "en", "standard", 24));
  });

  it.each([1, 3, 6, 12, 24] as const)("enforces the %s month limit", (months) => {
    expect(freshnessForVideo(monthsAgo(months + 1), months, now).allowed).toBe(false);
    expect(freshnessForVideo(monthsAgo(Math.max(0, months - 1)), months, now).allowed).toBe(true);
  });

  it("allows any age but still penalizes old videos deterministically", () => {
    expect(freshnessForVideo(new Date("2026-09-05T12:00:00.000Z"), null, now).penalty).toBe(0);
    expect(freshnessForVideo(monthsAgo(8), null, now).penalty).toBe(5);
    expect(freshnessForVideo(monthsAgo(18), null, now).penalty).toBe(10);
    expect(freshnessForVideo(monthsAgo(48), null, now)).toMatchObject({ allowed: true, penalty: 18 });
    expect(freshnessReason("subscribed", "Older video allowed by your filter")).toContain("Older video allowed");
  });

  it("maps internal scores to honest fit tiers", () => {
    expect(fitTier(75)).toBe("excellent");
    expect(fitTier(74)).toBe("strong");
    expect(fitTier(59)).toBe("good");
    expect(fitTier(44)).toBe("exploratory");
  });
});
