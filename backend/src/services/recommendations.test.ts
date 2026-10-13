import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { VideoSource } from "../generated/prisma/enums.js";
import { buildCreatorAffinities, buildDiscoveryLanes, buildHistoryTasteProfile, controlledGamingOverride, creatorFamilyName, discoveryLaneCapacity, discoveryPreferenceScore, discoverySearchQuery, enrichWatchHistorySignals, favoriteSubscriptionSlots, feedbackDecay, feedbackPenaltyForVideo, fitTier, freshnessForVideo, freshnessReason, gamingInterestKeys, hasExcludedTopicConflict, hasStrongTopicEvidence, historyAffinity, historyTermsForSearch, isLowTrustDiscoveryTitle, isPopularNewCreator, normalizeRecommendationRequest, normalizeSessionTopics, personalizedDiscoveryEvidence, recommendationSearchOrder, searchCacheKey, searchDurationForFormats, selectCandidates, subscriptionCandidateExpiration, topicCategoryIdForSearch, topicCategoryMismatch, youtubeSearchParameters } from "./recommendations.js";

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
    expect(youtubeSearchParameters("gaming", "en", 3, now, "20", "medium", "date")).toMatchObject({ order: "date" });
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
    expect(current).not.toBe(searchCacheKey("science", "en", "standard", 12, undefined, undefined, "date"));
  });

  it("uses a quality-aware search pool before ordering newest results locally", () => {
    expect(recommendationSearchOrder("newest", "viewCount")).toBe("viewCount");
    expect(recommendationSearchOrder("newest", "relevance")).toBe("relevance");
    expect(recommendationSearchOrder("best_match", "viewCount")).toBe("viewCount");
  });

  it("always gives newest mode a strict 30-day window", () => {
    const request = {
      minutes: 45, timeLimitEnabled: false, recommendationMode: "single", sortBy: "newest", resultCount: 10,
      intent: "entertain", source: "mixed", topics: ["technology"], formats: ["standard"], languages: ["en"],
      maxAgeMonths: null, audioFriendly: false, antiClickbait: true
    } as Parameters<typeof normalizeRecommendationRequest>[0];
    expect(normalizeRecommendationRequest(request)).toMatchObject({ sortBy: "newest", maxAgeMonths: 1 });
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
    expect(isPopularNewCreator(30_000n, 600n)).toBe(false);
    expect(isPopularNewCreator(30_000n, 100n)).toBe(false);
    expect(isPopularNewCreator(60_000n, 1_800n)).toBe(true);
    expect(isPopularNewCreator(100_000n)).toBe(false);
    expect(isPopularNewCreator(150_000n, 1_500n)).toBe(true);
    expect(isPopularNewCreator(1_000_000n, 3_000n)).toBe(true);
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
    expect(discoverySearchQuery(["gaming"], terms, "relax", 0)).toContain("minecraft");
    expect(discoverySearchQuery(["gaming"], terms, "relax", 0)).toContain("gaming");
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

  it("uses strict category conflicts for every single-topic session", () => {
    expect(topicCategoryMismatch({ categoryId: "17" }, ["travel"])).toBe(true);
    expect(topicCategoryMismatch({ categoryId: "25" }, ["travel"])).toBe(true);
    expect(topicCategoryMismatch({ categoryId: "20" }, ["finance"])).toBe(true);
    expect(topicCategoryMismatch({ categoryId: "20" }, ["cooking"])).toBe(true);
    expect(topicCategoryMismatch({ categoryId: "17" }, ["health"])).toBe(false);
    expect(topicCategoryIdForSearch("travel")).toBe("19");
    expect(topicCategoryIdForSearch("science")).toBe("28");
  });

  it("accepts real travel evidence and rejects the screenshot false positives", () => {
    const video = (title: string, categoryId: string, description = "", tags: string[] = []) => ({
      title,
      description,
      tags,
      categoryId,
      channel: { title: "Example", description: "" }
    });
    expect(hasStrongTopicEvidence(video("4 Days in Chongqing", "19"), "travel")).toBe(true);
    expect(hasStrongTopicEvidence(video("48 Hours in Baguio | Solo Travel Vlog", "22"), "travel")).toBe(true);
    expect(hasStrongTopicEvidence(video("I investigated the world's biggest city", "24"), "travel")).toBe(true);
    expect(hasStrongTopicEvidence(video("The frontline is moving fast towards this city", "25", "War coverage"), "travel")).toBe(false);
    expect(hasStrongTopicEvidence(video("Liverpool v Man City full game", "17"), "travel")).toBe(false);
    expect(hasStrongTopicEvidence(video("Justin Bieber Best Songs Playlist Mix | Listen And Travel With Me", "19"), "travel")).toBe(false);
    expect(hasStrongTopicEvidence(video("Cast Tests Their Travel Compatibility", "19", "A playful travel quiz", ["travel match"]), "travel")).toBe(false);
    expect(hasStrongTopicEvidence(video(
      "Roblox A Desert Trip, But It Got Wild",
      "22",
      "Subscribe for weekly travel planning and road trip tips",
      ["roblox", "gameplay"]
    ), "travel")).toBe(false);
  });

  it("requires strong evidence for non-travel topics too", () => {
    const video = (title: string, categoryId: string, description = "", tags: string[] = []) => ({
      title,
      description,
      tags,
      categoryId,
      channel: { title: "Example", description: "" }
    });
    expect(hasStrongTopicEvidence(video("Personal finance and ETF investing", "27"), "finance")).toBe(true);
    expect(hasStrongTopicEvidence(video("GTA Online fastest money method", "20"), "finance")).toBe(false);
    expect(hasStrongTopicEvidence(video("Premier League full game", "17"), "health")).toBe(false);
    expect(hasStrongTopicEvidence(video("Full body fitness workout", "17"), "health")).toBe(true);
    expect(hasStrongTopicEvidence(video("A science documentary about physics", "27"), "science")).toBe(true);
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

  it("makes a frequently watched creator stronger than an unrelated topic-only candidate", () => {
    const recent = new Date(now.getTime() - 10 * 86_400_000);
    const rows = [
      ...Array.from({ length: 12 }, (_, index) => ({
        videoId: `favorite-${index}`,
        title: `Different co-op adventure ${index}`,
        channelTitle: "Favorite Crew",
        topics: ["gaming"],
        watchedAt: recent
      })),
      { videoId: "other", title: "A strategy game", channelTitle: "Other Channel", topics: ["gaming"], watchedAt: recent }
    ];
    const profile = buildHistoryTasteProfile(rows);
    const favorite = historyAffinity({
      title: "A brand new upload",
      description: "",
      tags: [],
      channel: { title: "Favorite Crew" }
    } as never, ["gaming"], profile);
    const unrelated = historyAffinity({
      title: "A generic gaming upload",
      description: "",
      tags: [],
      channel: { title: "Unknown Creator" }
    } as never, ["gaming"], profile);
    expect(favorite.score).toBeGreaterThanOrEqual(30);
    expect(favorite.score).toBeGreaterThan(unrelated.score);
    expect(unrelated.matched).toBe(false);
  });

  it("enriches sparse imported history from known video and creator metadata", () => {
    const corpus = [
      { id: "known", channelId: "channel", title: "Co-op night", description: "", tags: [], categoryId: "20", topics: [], channel: { title: "Variety Crew" } },
      { id: "other", channelId: "channel", title: "Another upload", description: "Multiplayer gameplay", tags: [], categoryId: "20", topics: [], channel: { title: "Variety Crew" } }
    ];
    const enriched = enrichWatchHistorySignals([
      { videoId: "known", title: "Co-op night", channelTitle: "Variety Crew", topics: [] },
      { videoId: "missing", title: "An oddly named upload", channelTitle: "Variety Crew Plus", topics: [] }
    ], corpus as never);
    expect(enriched[0].topics).toContain("gaming");
    expect(enriched[1].topics).toContain("gaming");
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

  it("does not reject a gaming video because of an incidental excluded music label", () => {
    expect(hasExcludedTopicConflict(
      { categoryId: "20" },
      ["gaming", "music", "design"],
      ["music"],
      ["gaming"]
    )).toBe(false);
    expect(hasExcludedTopicConflict(
      { categoryId: "10" },
      ["music"],
      ["music"],
      ["gaming"]
    )).toBe(true);
    expect(hasExcludedTopicConflict(
      { categoryId: "20" },
      ["gaming", "music"],
      ["music"],
      []
    )).toBe(true);
  });

  it("builds creator-led discovery lanes from history and subscriptions", () => {
    const history = [
      ...Array.from({ length: 7 }, (_, index) => ({ title: `Funny multiplayer challenge ${index}`, channelTitle: "Variety Crew", topics: ["gaming"], watchedAt: now, origin: "history" as const })),
      ...Array.from({ length: 6 }, (_, index) => ({ title: `Minecraft survival challenge ${index}`, channelTitle: "Block Builder", topics: ["gaming"], watchedAt: now, origin: "history" as const })),
      ...Array.from({ length: 5 }, (_, index) => ({ title: `CS2 competitive ranked ${index}`, channelTitle: "Tactical Player", topics: ["gaming"], watchedAt: now, origin: "history" as const })),
      ...Array.from({ length: 4 }, (_, index) => ({ title: `Bloons BTD6 strategy challenge ${index}`, channelTitle: "Tower Expert", topics: ["gaming"], watchedAt: now, origin: "history" as const })),
      ...Array.from({ length: 3 }, (_, index) => ({ title: `Brawl Stars ranked strategy ${index}`, channelTitle: "Arena Guide", topics: ["gaming"], watchedAt: now, origin: "history" as const }))
    ];
    const subscriptions = Array.from({ length: 4 }, (_, index) => ({
      title: `Brawl Stars ranked ${index}`,
      channelTitle: "Arena Guide",
      topics: ["gaming"],
      origin: "subscription" as const
    }));
    const lanes = buildDiscoveryLanes([...history, ...subscriptions], ["gaming"], "relax", new Set(["arenaguide"]));
    expect(lanes).toHaveLength(4);
    expect(lanes.map((lane) => lane.label)).toEqual(expect.arrayContaining(["Variety Crew", "Block Builder", "Tactical Player", "Arena Guide"]));
    expect(new Set(lanes.map((lane) => lane.key)).size).toBe(4);
    expect(lanes.filter((lane) => lane.source === "history")).toHaveLength(3);
    expect(lanes.filter((lane) => lane.source === "subscription")).toHaveLength(1);
    expect(lanes.find((lane) => lane.label === "Variety Crew")?.query).toContain("challenge");
    expect(lanes.find((lane) => lane.label === "Variety Crew")?.query).not.toContain("\"Variety Crew\"");
  });

  it("does not let repeated plays of one video outweigh several unique recent videos", () => {
    const recent = new Date(now.getTime() - 5 * 86_400_000);
    const profile = buildHistoryTasteProfile([
      ...Array.from({ length: 20 }, () => ({ videoId: "repeat", title: "Same upload", channelTitle: "Repeat Channel", topics: ["gaming"], watchedAt: recent })),
      ...Array.from({ length: 4 }, (_, index) => ({ videoId: `unique-${index}`, title: `Different upload ${index}`, channelTitle: "Variety Channel", topics: ["gaming"], watchedAt: recent }))
    ]);
    expect(profile.creatorWeights.get(creatorFamilyName("Variety Channel"))!.weight)
      .toBeGreaterThan(profile.creatorWeights.get(creatorFamilyName("Repeat Channel"))!.weight);
  });

  it("requires repeated watched or liked evidence before a game becomes a preference", () => {
    const signals = [
      ...Array.from({ length: 7 }, (_, index) => ({
        title: `Ranked match ${index}`,
        channelTitle: "Mobile Tactics",
        topics: ["gaming"],
        origin: "history" as const,
        watchedAt: now,
        metadataText: "#clashroyale"
      })),
      ...Array.from({ length: 2 }, (_, index) => ({
        title: `A Brawl Stars match I liked ${index}`,
        channelTitle: "Mobile Tactics",
        topics: ["gaming"],
        origin: "liked" as const,
        metadataText: "#brawlstars"
      })),
      ...Array.from({ length: 4 }, (_, index) => ({
        title: `Unwatched Roblox upload ${index}`,
        channelTitle: "Mobile Tactics",
        topics: ["gaming"],
        origin: "subscription" as const,
        metadataText: "#roblox"
      }))
    ];
    const lane = buildDiscoveryLanes(signals, ["gaming"], "relax", new Set(["mobiletactics"]))[0];
    expect(lane?.preferredInterestKeys).toEqual(expect.arrayContaining(["clash-royale", "brawl-stars"]));
    expect(lane?.preferredInterestKeys).not.toContain("roblox");
    expect(lane?.query).toContain("clash royale");
    expect(lane?.query).toContain("brawl stars");
  });

  it("does not turn a single watched game into a discovery query", () => {
    const signals = [
      ...Array.from({ length: 10 }, (_, index) => ({
        videoId: `variety-${index}`,
        title: `Funny multiplayer challenge ${index}`,
        channelTitle: "Variety Player",
        topics: ["gaming"],
        origin: "history" as const
      })),
      {
        videoId: "one-gta-video",
        title: "One GTA session with friends",
        channelTitle: "Variety Player",
        topics: ["gaming"],
        origin: "history" as const
      }
    ];
    const lane = buildDiscoveryLanes(signals, ["gaming"], "entertain")[0];
    expect(lane?.query.toLowerCase()).not.toContain("gta");
    expect(lane?.allowedInterestKeys).not.toContain("gta");
    expect(personalizedDiscoveryEvidence(lane!, "GTA funny multiplayer gameplay")).toMatchObject({
      hasUnsupportedSpecificInterest: true,
      matched: false
    });
  });

  it("requires an allowed game or two shared style signals for a personal discovery result", () => {
    const lane = {
      preferredInterestKeys: ["minecraft"],
      allowedInterestKeys: ["minecraft"],
      anchorTerms: ["funny", "multiplayer"]
    };
    expect(personalizedDiscoveryEvidence(lane, "A Minecraft survival video").matched).toBe(true);
    expect(personalizedDiscoveryEvidence(lane, "A funny multiplayer party game").matched).toBe(true);
    expect(personalizedDiscoveryEvidence(lane, "A funny solo playthrough").matched).toBe(false);
    expect(personalizedDiscoveryEvidence(lane, "A funny multiplayer GTA video")).toMatchObject({
      hasUnsupportedSpecificInterest: true,
      matched: false
    });
    expect(personalizedDiscoveryEvidence(
      { preferredInterestKeys: ["counter-strike"], allowedInterestKeys: ["counter-strike"], anchorTerms: [] },
      "Geometry Dash challenge. The description casually mentions CS2 among other games.",
      "Geometry Dash challenge"
    ).matched).toBe(false);
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

  it("reserves most subscription results for frequently watched creators", () => {
    expect(favoriteSubscriptionSlots(10, "subscribed")).toBe(7);
    expect(favoriteSubscriptionSlots(5, "subscribed")).toBe(4);
    expect(favoriteSubscriptionSlots(10, "mixed")).toBe(4);
    expect(favoriteSubscriptionSlots(10, "new")).toBe(0);
  });

  it("fills as much of the history-first subscription target as available", () => {
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
      sortBy: "best_match",
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
    expect(selected.filter((item) => item.frequentCreator)).toHaveLength(6);
    expect(Math.max(...[...new Set(selected.map((item) => item.candidate.video.channelId))].map((channelId) => selected.filter((item) => item.candidate.video.channelId === channelId).length))).toBeLessThanOrEqual(2);
  });

  it("orders matching candidates by publication date in newest mode", () => {
    const candidate = (id: string, publishedAt: string, match: number) => ({
      candidate: {
        source: VideoSource.SUBSCRIBED,
        video: { id, channelId: `channel-${id}`, title: id, topics: ["science"], publishedAt: new Date(publishedAt) }
      },
      match,
      reason: "Test",
      signals: ["Test"],
      durationMinutes: 10,
      frequentCreator: false
    });
    const selected = selectCandidates([
      candidate("older-better-match", "2026-08-01T00:00:00.000Z", 95),
      candidate("newer-match", "2026-09-15T00:00:00.000Z", 55)
    ] as never, {
      minutes: 60,
      timeLimitEnabled: false,
      recommendationMode: "single",
      sortBy: "newest",
      resultCount: 3,
      intent: "learn",
      source: "subscribed",
      topics: ["science"],
      formats: ["standard"],
      languages: ["en"],
      maxAgeMonths: 12,
      audioFriendly: false,
      antiClickbait: true
    });
    expect(selected.map((item) => item.candidate.video.id)).toEqual(["newer-match", "older-better-match"]);
  });

  it("orders the final mixed-source set globally by publication date", () => {
    const candidate = (id: string, source: VideoSource, publishedAt: string) => ({
      candidate: {
        source,
        video: { id, channelId: `channel-${id}`, title: id, topics: ["science"], publishedAt: new Date(publishedAt) }
      },
      match: 70,
      reason: "Test",
      signals: ["Test"],
      durationMinutes: 10,
      frequentCreator: false
    });
    const selected = selectCandidates([
      candidate("subscribed-week-old", VideoSource.SUBSCRIBED, "2026-09-13T00:00:00.000Z"),
      candidate("new-day-old", VideoSource.NEW, "2026-09-19T00:00:00.000Z"),
      candidate("subscribed-month-old", VideoSource.SUBSCRIBED, "2026-08-20T00:00:00.000Z")
    ] as never, {
      minutes: 60,
      timeLimitEnabled: false,
      recommendationMode: "single",
      sortBy: "newest",
      resultCount: 3,
      intent: "learn",
      source: "mixed",
      topics: ["science"],
      formats: ["standard"],
      languages: ["en"],
      maxAgeMonths: 12,
      audioFriendly: false,
      antiClickbait: true
    });
    expect(selected.map((item) => item.candidate.video.id)).toEqual([
      "new-day-old",
      "subscribed-week-old",
      "subscribed-month-old"
    ]);
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

  it("backfills an unused discovery-lane slot when other valid candidates exist", () => {
    const laneCounts = [1, 3, 2, 2, 2];
    const scored = laneCounts.flatMap((count, laneIndex) => Array.from({ length: count }, (_, itemIndex) => ({
      candidate: {
        source: VideoSource.NEW,
        video: {
          id: `lane-${laneIndex}-video-${itemIndex}`,
          channelId: `channel-${laneIndex}-${itemIndex}`,
          title: `Travel video ${laneIndex}-${itemIndex}`,
          topics: ["travel"]
        },
        discoveryLane: {
          key: `lane-${laneIndex}`,
          label: `Lane ${laneIndex}`,
          query: "travel",
          source: "interest",
          seedChannelTitle: null,
          preferredInterestKeys: [],
          anchorTerms: [],
          order: "relevance",
          durationVariant: 0
        }
      },
      match: 80 - laneIndex - itemIndex,
      reason: "Test",
      signals: ["Test"],
      durationMinutes: 10,
      frequentCreator: false
    })));
    const selected = selectCandidates(scored as never, {
      minutes: 60,
      timeLimitEnabled: false,
      recommendationMode: "single",
      sortBy: "best_match",
      resultCount: 10,
      intent: "entertain",
      source: "new",
      topics: ["travel"],
      formats: ["standard"],
      languages: ["en"],
      maxAgeMonths: 6,
      audioFriendly: false,
      antiClickbait: true
    });
    expect(selected).toHaveLength(10);
  });

  it("does not let one recognized game dominate a ten-result discovery set", () => {
    const candidates = [
      ...Array.from({ length: 6 }, (_, index) => ({ id: `gta-${index}`, title: `GTA Online challenge ${index}` })),
      ...Array.from({ length: 5 }, (_, index) => ({ id: `minecraft-${index}`, title: `Minecraft survival ${index}` })),
      ...Array.from({ length: 5 }, (_, index) => ({ id: `variety-${index}`, title: `Co-op party game ${index}` }))
    ].map((item, index) => ({
      candidate: {
        source: VideoSource.NEW,
        video: { id: item.id, channelId: `channel-${index}`, title: item.title, description: "", tags: [], topics: ["gaming"] },
        topicOverride: false
      },
      match: 100 - index,
      reason: "Test",
      signals: ["Test"],
      durationMinutes: 10,
      frequentCreator: false
    }));
    const selected = selectCandidates(candidates as never, {
      minutes: 60,
      timeLimitEnabled: false,
      recommendationMode: "single",
      sortBy: "best_match",
      resultCount: 10,
      intent: "entertain",
      source: "new",
      topics: ["gaming"],
      formats: ["standard"],
      languages: ["en"],
      maxAgeMonths: 12,
      audioFriendly: false,
      antiClickbait: true
    });
    expect(selected).toHaveLength(10);
    expect(selected.filter((item) => item.candidate.video.id.startsWith("gta-"))).toHaveLength(3);
    expect(selected.filter((item) => item.candidate.video.id.startsWith("minecraft-"))).toHaveLength(3);
  });

  it("filters recurring low-trust discovery patterns when anti-clickbait is enabled", () => {
    expect(isLowTrustDiscoveryTitle("GOOD BOY VS BAD BOY - Slow English Episode 47")).toBe(true);
    expect(isLowTrustDiscoveryTitle("Skibidi Soundwave - Season 7")).toBe(true);
    expect(isLowTrustDiscoveryTitle("JJ adventure - Minecraft Animation", "MS Toons")).toBe(true);
    expect(isLowTrustDiscoveryTitle("TRAVEL with US! SURPRISE ENDING! #vlog #travel #fyp #trending")).toBe(true);
    expect(isLowTrustDiscoveryTitle("VIRAL WILD INSANE city challenge")).toBe(true);
    expect(isLowTrustDiscoveryTitle("Minecraft redstone explained", "Block Lab")).toBe(false);
    expect(isLowTrustDiscoveryTitle("48 Hours in Baguio | Solo Travel Vlog")).toBe(false);
    expect(isLowTrustDiscoveryTitle("A thoughtful Counter-Strike documentary")).toBe(false);
  });
});
