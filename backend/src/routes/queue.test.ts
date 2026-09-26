import { describe, expect, it } from "vitest";
import { sortQueueRecords } from "./queue.js";

const rows = [
  { id: "a", createdAt: new Date("2026-01-01"), video: { publishedAt: new Date("2025-01-01"), durationSeconds: 600 } },
  { id: "b", createdAt: new Date("2026-03-01"), video: { publishedAt: new Date("2026-02-01"), durationSeconds: 120 } },
  { id: "c", createdAt: new Date("2026-02-01"), video: { publishedAt: new Date("2025-06-01"), durationSeconds: 1800 } }
];

describe("queue sorting", () => {
  it.each([
    ["saved_newest", ["b", "c", "a"]],
    ["saved_oldest", ["a", "c", "b"]],
    ["published_newest", ["b", "c", "a"]],
    ["published_oldest", ["a", "c", "b"]],
    ["shortest", ["b", "a", "c"]],
    ["longest", ["c", "a", "b"]]
  ] as const)("sorts by %s", (sort, expected) => {
    expect(sortQueueRecords(rows, sort).map((item) => item.id)).toEqual(expected);
  });
});
