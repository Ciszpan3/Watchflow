import { describe, expect, it } from "vitest";
import { demoVideos } from "../data/demoData.js";
import { calculateEngagementRate, calculateOpportunityScore, calculateViewsPerSubscriber, sortVideos } from "./metrics.js";

describe("metrics", () => {
  it("calculates engagement rate", () => {
    expect(calculateEngagementRate(1000, 80, 20)).toBe(0.1);
  });

  it("returns zero engagement when views are missing", () => {
    expect(calculateEngagementRate(0, 80, 20)).toBe(0);
  });

  it("calculates views per subscriber", () => {
    expect(calculateViewsPerSubscriber(5000, 1000)).toBe(5);
  });

  it("scores strong opportunity videos highly", () => {
    expect(calculateOpportunityScore({ engagementRate: 0.08, viewsPerSubscriber: 3 })).toBe(100);
  });

  it("sorts videos in either direction", () => {
    expect(sortVideos(demoVideos, "views", "desc")[0].id).toBe("vid-1");
    expect(sortVideos(demoVideos, "views", "asc")[0].id).toBe("vid-3");
  });
});
