import { describe, expect, it } from "vitest";
import { assertSyncActive, mapWithConcurrency } from "./viewerSync.js";

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
});
