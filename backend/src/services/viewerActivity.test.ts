import { describe, expect, it } from "vitest";
import { buildContentDiet } from "./viewerActivity.js";

const now = new Date("2026-10-15T12:00:00.000Z");

function entry(daysAgo: number, channelId: string, durationSeconds: number, intent: string, topics: string[]) {
  return {
    watchedAt: new Date(now.getTime() - daysAgo * 86_400_000),
    video: { channelId, durationSeconds, intents: [intent], topics }
  };
}

describe("content diet", () => {
  it("summarizes only explicitly supplied activity from the selected period", () => {
    const result = buildContentDiet([
      entry(1, "known", 601, "learn", ["science", "science"]),
      entry(2, "new", 300, "relax", ["travel"]),
      entry(9, "old", 900, "solve", ["technology"])
    ], new Set(["known"]), now);

    expect(result).toMatchObject({
      watchedCount: 2,
      totalMinutes: 16,
      uniqueChannels: 2,
      sources: { subscribed: 1, new: 1 }
    });
    expect(result.categories).toEqual([
      { key: "learning", label: "Learning", count: 1, percentage: 50 },
      { key: "relaxation", label: "Relaxation", count: 1, percentage: 50 }
    ]);
    expect(result.topTopics).toEqual([{ topic: "science", count: 1 }, { topic: "travel", count: 1 }]);
  });

  it("returns an honest empty summary without inferred activity", () => {
    const result = buildContentDiet([], new Set(), now);
    expect(result.watchedCount).toBe(0);
    expect(result.categories).toEqual([]);
    expect(result.topTopics).toEqual([]);
    expect(result.sources).toEqual({ subscribed: 0, new: 0 });
  });
});
