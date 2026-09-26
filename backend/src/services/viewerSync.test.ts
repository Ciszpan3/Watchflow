import { describe, expect, it } from "vitest";
import { assertSyncActive, mapWithConcurrency, selectSubscriptionChannels, subscriptionUploadPageSize } from "./viewerSync.js";

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

  it("keeps upload playlist requests within YouTube's page limit", () => {
    expect(subscriptionUploadPageSize(0)).toBe(1);
    expect(subscriptionUploadPageSize(50)).toBe(50);
    expect(subscriptionUploadPageSize(200)).toBe(50);
  });
});
