import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { buildDiscoveryLanes, creatorFamilyName, discoveryLaneCapacity, discoverySearchQuery, fitTier, freshnessForVideo, freshnessReason, gamingInterestKeys, historyAffinity, historyTermsForSearch, isLowTrustDiscoveryTitle, isPopularNewCreator, searchCacheKey, searchDurationForFormats, subscriptionCandidateExpiration, topicCategoryMismatch, youtubeSearchParameters } from "./recommendations.js";

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

  it("builds creator-led discovery lanes from history and subscriptions", () => {
    const history = [
      ...Array.from({ length: 7 }, (_, index) => ({ title: `Variety challenge ${index}`, channelTitle: "Variety Crew", topics: ["gaming"], origin: "history" as const })),
      ...Array.from({ length: 6 }, (_, index) => ({ title: `Minecraft trap ${index}`, channelTitle: "Block Builder", topics: ["gaming"], origin: "history" as const })),
      ...Array.from({ length: 5 }, (_, index) => ({ title: `CS2 clutch ${index}`, channelTitle: "Tactical Player", topics: ["gaming"], origin: "history" as const })),
      ...Array.from({ length: 4 }, (_, index) => ({ title: `Bloons BTD6 challenge ${index}`, channelTitle: "Tower Expert", topics: ["gaming"], origin: "history" as const }))
    ];
    const subscriptions = Array.from({ length: 4 }, (_, index) => ({
      title: `Brawl Stars ranked ${index}`,
      channelTitle: "Arena Guide",
      topics: ["gaming"],
      origin: "subscription" as const
    }));
    const lanes = buildDiscoveryLanes([...history, ...subscriptions], ["gaming"], new Set(["arenaguide"]));
    expect(lanes).toHaveLength(5);
    expect(lanes.map((lane) => lane.label)).toEqual(expect.arrayContaining(["Variety Crew", "Block Builder", "Tactical Player", "Tower Expert", "Arena Guide"]));
    expect(new Set(lanes.map((lane) => lane.key)).size).toBe(5);
    expect(lanes.find((lane) => lane.label === "Arena Guide")?.source).toBe("subscription");
    expect(lanes.find((lane) => lane.label === "Arena Guide")?.interestKeys).toContain("brawl-stars");
  });

  it("uses metadata to build multi-game profiles for subscribed creators", () => {
    const signals = [
      ...Array.from({ length: 4 }, (_, index) => ({
        title: `Ranked match ${index}`,
        channelTitle: "Mobile Tactics",
        topics: ["gaming"],
        origin: "subscription" as const,
        metadataText: "#clashroyale"
      })),
      ...Array.from({ length: 4 }, (_, index) => ({
        title: `Ranked challenge ${index}`,
        channelTitle: "Mobile Tactics",
        topics: ["gaming"],
        origin: "subscription" as const,
        metadataText: "#brawlstars"
      }))
    ];
    const lane = buildDiscoveryLanes(signals, ["gaming"], new Set(["mobiletactics"]))[0];
    expect(lane?.interestKeys).toEqual(expect.arrayContaining(["clash-royale", "brawl-stars"]));
    expect(lane?.query).toContain("clash royale|brawl stars");
  });

  it("recognizes alternate channels from the same creator family", () => {
    expect(creatorFamilyName("Mehalic POPs")).toBe(creatorFamilyName("More Mehalic"));
    expect(creatorFamilyName("SMii7Y")).toBe(creatorFamilyName("SMii7Yplus"));
    expect(creatorFamilyName("JudeHigh")).toBe(creatorFamilyName("JudeLow"));
  });

  it("recognizes game-specific metadata instead of treating all gaming as equivalent", () => {
    expect(gamingInterestKeys("#clashroyale xbow strategy")).toContain("clash-royale");
    expect(gamingInterestKeys("#brawlstars ranked match")).toContain("brawl-stars");
    expect(gamingInterestKeys("generic Roblox episode")).not.toEqual(expect.arrayContaining(["clash-royale", "brawl-stars"]));
  });

  it("reserves room for every active discovery lane", () => {
    expect(discoveryLaneCapacity(10, 5)).toBe(2);
    expect(discoveryLaneCapacity(5, 4)).toBe(2);
    expect(discoveryLaneCapacity(3, 5)).toBe(1);
    expect(discoveryLaneCapacity(10, 1)).toBe(10);
  });

  it("filters recurring low-trust discovery patterns when anti-clickbait is enabled", () => {
    expect(isLowTrustDiscoveryTitle("GOOD BOY VS BAD BOY - Slow English Episode 47")).toBe(true);
    expect(isLowTrustDiscoveryTitle("Skibidi Soundwave - Season 7")).toBe(true);
    expect(isLowTrustDiscoveryTitle("JJ adventure - Minecraft Animation", "MS Toons")).toBe(true);
    expect(isLowTrustDiscoveryTitle("Minecraft redstone explained", "Block Lab")).toBe(false);
    expect(isLowTrustDiscoveryTitle("A thoughtful Counter-Strike documentary")).toBe(false);
  });
});
