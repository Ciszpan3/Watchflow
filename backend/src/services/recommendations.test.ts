import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { discoverySearchQuery, fitTier, freshnessForVideo, freshnessReason, historyAffinity, historyTermsForSearch, isPopularNewCreator, searchCacheKey, searchDurationForFormats, subscriptionCandidateExpiration, topicCategoryMismatch, youtubeSearchParameters } from "./recommendations.js";

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
      maxResults: 50,
      publishedAfter: "2024-09-20T12:00:00.000Z"
    });
    expect(youtubeSearchParameters("gaming", "en", 3, now, "20")).toMatchObject({ videoCategoryId: "20" });
    expect(youtubeSearchParameters("gaming", "en", 3, now, "20", "medium")).toMatchObject({ videoDuration: "medium" });
    expect(youtubeSearchParameters("gaming", "en", 3, now, "20", "medium", "viewCount")).toMatchObject({ order: "viewCount" });
    expect(youtubeSearchParameters("science", "en", 3, now)).not.toHaveProperty("videoCategoryId");
    expect(youtubeSearchParameters("science learn", "en", null, now)).not.toHaveProperty("publishedAfter");
  });

  it("uses both YouTube duration bands to fill a standard-video pool", () => {
    expect(searchDurationForFormats(["standard"], 0)).toBe("medium");
    expect(searchDurationForFormats(["standard"], 1)).toBe("long");
    expect(searchDurationForFormats(["short"], 0)).toBe("short");
    expect(searchDurationForFormats(["podcast"], 0)).toBe("long");
    expect(searchDurationForFormats(["standard", "short"], 0)).toBeUndefined();
  });

  it("versions search cache keys independently from the legacy policy", () => {
    const current = searchCacheKey("science", "en", "standard", 12);
    const legacy = createHash("sha256").update("science|en|standard").digest("hex");
    expect(current).not.toBe(legacy);
    expect(current).not.toBe(searchCacheKey("science", "en", "standard", 24));
    expect(current).not.toBe(searchCacheKey("science", "en", "standard", 12, "20"));
    expect(current).not.toBe(searchCacheKey("science", "en", "standard", 12, undefined, "long"));
    expect(current).not.toBe(searchCacheKey("science", "en", "standard", 12, undefined, undefined, "viewCount"));
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

  it("keeps low-view discovery out while allowing trusted subscriptions", () => {
    expect(isPopularNewCreator(999n)).toBe(false);
    expect(isPopularNewCreator(9_999n)).toBe(false);
    expect(isPopularNewCreator(24_999n, 10_000n)).toBe(false);
    expect(isPopularNewCreator(30_000n, 600n)).toBe(true);
    expect(isPopularNewCreator(30_000n, 100n)).toBe(false);
    expect(isPopularNewCreator(100_000n)).toBe(true);
  });

  it("keeps subscription candidates available longer than a sync cache", () => {
    const start = new Date("2026-09-20T12:00:00.000Z");
    expect(subscriptionCandidateExpiration(start).getTime() - start.getTime()).toBe(30 * 86_400_000);
  });

  it("builds new-creator search terms from relevant imported history", () => {
    expect(historyTermsForSearch([
      { title: "Minecraft survival building", channelTitle: "Block Lab", topics: ["gaming"] },
      { title: "Minecraft redstone ideas", channelTitle: "Block Lab", topics: ["gaming"] },
      { title: "GTA money guide", channelTitle: "Random GTA", topics: ["gaming"] }
    ], ["gaming"])).toContain("minecraft");
    expect(historyTermsForSearch([
      { title: "Minecraft survival building", channelTitle: "Block Lab", topics: ["gaming"] }
    ], ["finance"])).toEqual([]);
  });

  it("drops generic import labels and builds a focused discovery query", () => {
    const terms = historyTermsForSearch([
      { title: "Obejrzano Minecraft survival game", channelTitle: "Gaming Video", topics: ["gaming"] },
      { title: "Watched Minecraft redstone episode", channelTitle: "Gaming Video", topics: ["gaming"] }
    ], ["gaming"]);
    expect(terms).toContain("minecraft");
    expect(terms).not.toEqual(expect.arrayContaining(["obejrzano", "watched", "gaming", "game", "video", "episode"]));
    expect(discoverySearchQuery(["gaming"], terms, "relax", 0)).toBe("minecraft gaming");
    expect(discoverySearchQuery(["gaming"], ["minecraft", "zelda"], "relax", 0)).toBe("minecraft|zelda gaming");
    expect(discoverySearchQuery(["gaming"], ["minecraft", "zelda"], "relax", 1)).toBe("minecraft peaceful gaming");
  });

  it("requires the YouTube gaming category for a gaming session", () => {
    expect(topicCategoryMismatch({ categoryId: "20" }, ["gaming"])).toBe(false);
    expect(topicCategoryMismatch({ categoryId: "22" }, ["gaming"])).toBe(true);
    expect(topicCategoryMismatch({ categoryId: "27" }, ["gaming"])).toBe(true);
    expect(topicCategoryMismatch({ categoryId: "20" }, ["finance"])).toBe(true);
  });

  it("does not claim history affinity from a generic topic alone", () => {
    const video = {
      title: "A peaceful walk in Los Santos",
      channel: { title: "DayDream Gaming" }
    } as Parameters<typeof historyAffinity>[0];
    expect(historyAffinity(video, ["gaming"], [
      { title: "Minecraft survival building", channelTitle: "Block Lab", topics: ["gaming"] }
    ])).toMatchObject({ matched: false });
    expect(historyAffinity({ ...video, title: "Minecraft survival ideas" }, ["gaming"], [
      { title: "Minecraft survival building", channelTitle: "Block Lab", topics: ["gaming"] }
    ], ["minecraft"])).toMatchObject({ matched: true, anchor: "minecraft" });
  });
});
