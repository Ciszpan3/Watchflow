import { describe, expect, it } from "vitest";
import { parseTakeoutHistory } from "./WatchHistoryModal";

describe("Google Takeout watch history parser", () => {
  it("normalizes watched entries and extracts YouTube video ids", () => {
    const result = parseTakeoutHistory([{
      title: "Watched How to build a desk",
      titleUrl: "https://www.youtube.com/watch?v=abcDEF_1234",
      time: "2026-09-20T12:00:00Z",
      subtitles: [{ name: "Workshop" }]
    }]);
    expect(result).toEqual([{
      videoId: "abcDEF_1234",
      title: "How to build a desk",
      channelTitle: "Workshop",
      watchedAt: "2026-09-20T12:00:00.000Z"
    }]);
  });

  it("ignores malformed entries and limits the import to recent valid rows", () => {
    expect(parseTakeoutHistory([{ title: "Missing timestamp" }, { title: "Watched valid", time: "2026-09-20T12:00:00Z" }])).toHaveLength(1);
  });
});
