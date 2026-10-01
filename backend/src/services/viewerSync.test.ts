import { describe, expect, it } from "vitest";
import { assertSyncActive, frequentSubscriptionChannels, mapWithConcurrency, selectSubscriptionChannels, subscriptionUploadPageSize } from "./viewerSync.js";

describe("viewer synchronization helpers", () => {
  it("keeps result order and respects the concurrency limit", async () => {
    let activeWorkers = 0;
    let peakWorkers = 0;

    const result = await mapWithConcurrency([1, 2, 3, 4, 5, 6], 2, async (value) => {
      activeWorkers += 1;
      peakWorkers = Math.max(peakWorkers, activeWorkers);
      await new Promise((resolve) => setTimeout(resolve, 5));
      activeWorkers -= 1;
      return value * 2;
    });

    expect(result).toEqual([2, 4, 6, 8, 10, 12]);
    expect(peakWorkers).toBe(2);
  });

  it("stops work after the synchronization deadline", () => {
    expect(() => assertSyncActive(1_000, 999)).not.toThrow();
    expect(() => assertSyncActive(1_000, 1_000)).toThrowError(
      expect.objectContaining({ code: "sync_timeout" })
    );
  });

  it("prioritizes subscriptions with new uploads before liked and rotated channels", () => {
    const subscriptions = [
      { channelId: "older-a", newItemCount: 0 },
      { channelId: "fresh-one", newItemCount: 1 },
      { channelId: "liked", newItemCount: 0 },
      { channelId: "fresh-three", newItemCount: 3 },
      { channelId: "older-b", newItemCount: 0 }
    ];
    expect(selectSubscriptionChannels(subscriptions, new Set(["liked"]), 0, 4)).toEqual([
      "fresh-three",
      "fresh-one",
      "liked",
      "older-a"
    ]);
  });

  it("reserves half of a limited sync for frequently watched subscriptions", () => {
    const subscriptions = Array.from({ length: 8 }, (_, index) => ({ channelId: `channel-${index}`, newItemCount: index < 4 ? 10 - index : 0 }));
    expect(selectSubscriptionChannels(subscriptions, new Set(), 0, 4, ["channel-7", "channel-6", "channel-5"])).toEqual([
      "channel-7",
      "channel-6",
      "channel-0",
      "channel-1"
    ]);
  });

  it("matches imported history to safe creator-family name variants", () => {
    const recent = new Date("2026-09-20T00:00:00.000Z");
    const channels = [
      { id: "smii7y", snippet: { title: "SMii7Y" } },
      { id: "other", snippet: { title: "Other Channel" } }
    ];
    const history = [
      ...Array.from({ length: 8 }, (_, index) => ({ videoId: `video-${index}`, title: `Video ${index}`, channelTitle: "SMii7Yplus", watchedAt: recent })),
      ...Array.from({ length: 4 }, (_, index) => ({ videoId: `other-${index}`, title: `Other ${index}`, channelTitle: "Other Channel", watchedAt: recent }))
    ];
    expect(frequentSubscriptionChannels(channels, history, new Date("2026-10-01T00:00:00.000Z"))).toEqual(["smii7y"]);
  });

  it("keeps upload playlist requests within YouTube's page limit", () => {
    expect(subscriptionUploadPageSize(0)).toBe(1);
    expect(subscriptionUploadPageSize(50)).toBe(50);
    expect(subscriptionUploadPageSize(200)).toBe(50);
  });
});
