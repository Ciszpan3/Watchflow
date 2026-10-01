import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { VideoSource } from "../generated/prisma/enums.js";
import { buildCreatorAffinities, buildDiscoveryLanes, controlledGamingOverride, creatorFamilyName, discoveryLaneCapacity, discoveryPreferenceScore, discoverySearchQuery, favoriteSubscriptionSlots, feedbackDecay, feedbackPenaltyForVideo, fitTier, freshnessForVideo, freshnessReason, gamingInterestKeys, hasStrongTopicEvidence, historyAffinity, historyTermsForSearch, isLowTrustDiscoveryTitle, isPopularNewCreator, normalizeSessionTopics, searchCacheKey, searchDurationForFormats, selectCandidates, subscriptionCandidateExpiration, topicCategoryMismatch, youtubeSearchParameters } from "./recommendations.js";

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
    expect(topicCategoryMismatch({ categoryId: "20" }, ["technology", "gaming"])).toBe(false);
    expect(topicCategoryMismatch({ categoryId: "28" }, ["technology", "gaming"])).toBe(false);
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

  it("rejects accidental tech and space words without semantic evidence", () => {
    const video = (title: string, categoryId: string, channel = "Example") => ({
      title,
      categoryId,
      description: null,
      tags: [],
      channel: { title: channel, description: null }
    });
    expect(hasStrongTopicEvidence(video("Georgia Tech football highlights", "17", "ESPN"), "technology")).toBe(false);
    expect(hasStrongTopicEvidence(video("World Wide Technology Raceway", "17", "NASCAR"), "technology")).toBe(false);
    expect(hasStrongTopicEvidence(video("AI researcher explains model risk", "25", "News"), "technology")).toBe(true);
    expect(hasStrongTopicEvidence(video("Lesbian Space Princess review", "23"), "science")).toBe(false);
    expect(hasStrongTopicEvidence(video("NASA's new telescope might break physics", "28"), "science")).toBe(true);
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
    const lanes = buildDiscoveryLanes([...history, ...subscriptions], ["gaming"], "relax", new Set(["arenaguide"]));
    expect(lanes).toHaveLength(5);
    expect(lanes.map((lane) => lane.label)).toEqual(expect.arrayContaining(["Variety Crew", "Block Builder", "Arena Guide", "variety gaming", "broader gaming"]));
    expect(new Set(lanes.map((lane) => lane.key)).size).toBe(5);
    expect(lanes.find((lane) => lane.label === "Arena Guide")?.source).toBe("subscription");
    expect(lanes.find((lane) => lane.label === "Arena Guide")?.preferredInterestKeys).toEqual([]);
  });

  it("requires watched or liked evidence before a game becomes a preference", () => {
    const signals = [
      ...Array.from({ length: 4 }, (_, index) => ({
        title: `Ranked match ${index}`,
        channelTitle: "Mobile Tactics",
        topics: ["gaming"],
        origin: "history" as const,
        metadataText: "#clashroyale"
      })),
      {
        title: "A Brawl Stars match I liked",
        channelTitle: "Mobile Tactics",
        topics: ["gaming"],
        origin: "liked" as const,
        metadataText: "#brawlstars"
      },
      ...Array.from({ length: 8 }, (_, index) => ({
        title: `Unwatched Brawl upload ${index}`,
        channelTitle: "Mobile Tactics",
        topics: ["gaming"],
        origin: "subscription" as const,
        metadataText: "#brawlstars"
      }))
    ];
    const lane = buildDiscoveryLanes(signals, ["gaming"], "relax", new Set(["mobiletactics"]))[0];
    expect(lane?.preferredInterestKeys).toEqual(expect.arrayContaining(["clash-royale", "brawl-stars"]));
    expect(lane?.query).toContain("clash royale|brawl stars");
  });

  it("uses recognized games as ranking boosts instead of required filters", () => {
    const preferred = discoveryPreferenceScore("history", ["minecraft"], [], "A Minecraft challenge");
    const otherGame = discoveryPreferenceScore("history", ["minecraft"], [], "A new co-op horror game");
    expect(preferred).toBeGreaterThan(otherGame);
    expect(otherGame).toBeGreaterThan(0);
  });

  it("normalizes accumulated legacy topics to the last explicit selection", () => {
    expect(normalizeSessionTopics(["gaming", "technology", "science"])).toEqual(["science"]);
    expect(normalizeSessionTopics([])).toEqual([]);
  });

  it("recognizes alternate channels from the same creator family", () => {
    expect(creatorFamilyName("Mehalic POPs")).toBe(creatorFamilyName("More Mehalic"));
    expect(creatorFamilyName("SMii7Y")).toBe(creatorFamilyName("SMii7Yplus"));
    expect(creatorFamilyName("JudeHigh")).toBe(creatorFamilyName("JudeLow"));
  });

  it("reserves about half of subscription results for frequently watched creators", () => {
    expect(favoriteSubscriptionSlots(10, "subscribed")).toBe(5);
    expect(favoriteSubscriptionSlots(5, "subscribed")).toBe(3);
    expect(favoriteSubscriptionSlots(10, "mixed")).toBe(3);
    expect(favoriteSubscriptionSlots(10, "new")).toBe(0);
  });

  it("actually fills about half of a ten-result subscription set with favorite creators", () => {
    const scored = [
      ...Array.from({ length: 6 }, (_, index) => ({ id: `favorite-${index}`, frequent: true, score: 50 })),
      ...Array.from({ length: 10 }, (_, index) => ({ id: `regular-${index}`, frequent: false, score: 100 - index }))
    ].map((item) => ({
      candidate: {
        source: VideoSource.SUBSCRIBED,
        video: { id: item.id, channelId: `channel-${item.id}`, title: item.id, topics: ["gaming"] },
        topicOverride: false
      },
      match: item.score,
      reason: "Test",
      signals: ["Test"],
      durationMinutes: 10,
      frequentCreator: item.frequent
    }));
    const selected = selectCandidates(scored as never, {
      minutes: 60,
      timeLimitEnabled: false,
      recommendationMode: "single",
      resultCount: 10,
      intent: "entertain",
      source: "subscribed",
      topics: ["gaming"],
      formats: ["standard"],
      languages: ["en"],
      maxAgeMonths: 12,
      audioFriendly: false,
      antiClickbait: true
    });
    expect(selected).toHaveLength(10);
    expect(selected.filter((item) => item.frequentCreator)).toHaveLength(5);
    expect(Math.max(...[...new Set(selected.map((item) => item.candidate.video.channelId))].map((channelId) => selected.filter((item) => item.candidate.video.channelId === channelId).length))).toBeLessThanOrEqual(2);
  });

  it("builds a recency-aware creator affinity without letting repeat watches dominate", () => {
    const recent = new Date(now.getTime() - 10 * 86_400_000);
    const old = new Date(now.getTime() - 500 * 86_400_000);
    const history = [
      ...Array.from({ length: 20 }, () => ({ videoId: "repeat", title: "The same upload", channelTitle: "SMii7Y", topics: ["gaming"], watchedAt: recent })),
      ...Array.from({ length: 6 }, (_, index) => ({ videoId: `unique-${index}`, title: `Co-op game ${index}`, channelTitle: "SMii7Yplus", topics: ["gaming"], watchedAt: index < 4 ? recent : old }))
    ];
    const corpus = Array.from({ length: 8 }, (_, index) => ({
      channelId: "channel-1",
      title: `Variety gameplay ${index}`,
      description: "Funny multiplayer game with friends",
      tags: ["gaming", "multiplayer"],
      categoryId: index < 2 ? "20" : "24",
      topics: index < 2 ? ["gaming"] : [],
      channel: { title: "SMii7Y" }
    }));
    const affinity = buildCreatorAffinities(history, corpus as never, new Set(["channel-1"]), new Set(["channel-1"]), new Set(), now).get(creatorFamilyName("SMii7Y"));
    expect(affinity).toMatchObject({ frequent: true, uniqueHistoryCount: 7, historyCount: 26 });
    expect(affinity!.weightedHistory).toBeLessThan(12);
    expect(affinity!.score).toBeGreaterThan(25);
  });

  it("allows a controlled gaming override only for a proven frequent subscription", () => {
    const entertainmentVideo = {
      channelId: "channel-1",
      title: "A chaotic co-op night",
      description: "A multiplayer gameplay session",
      tags: [],
      categoryId: "24",
      topics: [],
      channel: { title: "Variety Crew" }
    };
    expect(controlledGamingOverride(entertainmentVideo as never, {
      key: "varietycrew", title: "Variety Crew", historyCount: 40, uniqueHistoryCount: 20,
      weightedHistory: 18, score: 24, frequent: true, gamingConfidence: 0.7
    })).toBe(true);
    expect(controlledGamingOverride(entertainmentVideo as never, {
      key: "random", title: "Random", historyCount: 1, uniqueHistoryCount: 1,
      weightedHistory: 1, score: 1, frequent: false, gamingConfidence: 0.7
    })).toBe(false);
  });

  it("decays scoped feedback over 30 days while leaving unrelated scopes untouched", () => {
    const target = { channelId: "channel-1", durationSeconds: 2_400, topics: ["gaming"] };
    const recentFeedback = [{
      reason: "TOO_LONG" as const,
      targetTopics: [],
      updatedAt: new Date(now.getTime() - 5 * 86_400_000),
      video: { channelId: "other", durationSeconds: 1_800, topics: ["science"] }
    }];
    const expiredFeedback = recentFeedback.map((item) => ({ ...item, updatedAt: new Date(now.getTime() - 31 * 86_400_000) }));
    expect(feedbackPenaltyForVideo(target, target.topics, recentFeedback, now)).toBeGreaterThan(0);
    expect(feedbackPenaltyForVideo(target, target.topics, expiredFeedback, now)).toBe(0);
    expect(feedbackDecay(new Date(now.getTime() - 15 * 86_400_000), now)).toBeCloseTo(0.5);
    expect(feedbackPenaltyForVideo({ ...target, durationSeconds: 600 }, target.topics, recentFeedback, now)).toBe(0);
    expect(feedbackPenaltyForVideo({ ...target, durationSeconds: 7_200 }, target.topics, recentFeedback, now)).toBe(0);
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
