import type { Insight, VideoPerformance } from "../types.js";

export function generateDeterministicInsights(videos: VideoPerformance[]): Insight[] {
  if (videos.length === 0) {
    return [];
  }

  const byOpportunity = [...videos].sort((a, b) => b.opportunityScore - a.opportunityScore);
  const byEngagement = [...videos].sort((a, b) => b.engagementRate - a.engagementRate);
  const byReach = [...videos].sort((a, b) => b.viewsPerSubscriber - a.viewsPerSubscriber);

  return [
    {
      id: "generated-opportunity",
      type: "opportunity",
      title: "Best follow-up opportunity",
      summary: `${byOpportunity[0].title} combines strong engagement with enough reach to justify a related follow-up.`,
      recommendation:
        "Plan a sequel or deeper breakdown using the same topic angle, then test a sharper title and thumbnail.",
      confidence: 0.84,
      sourceVideoIds: [byOpportunity[0].id]
    },
    {
      id: "generated-engagement",
      type: "audience",
      title: "Audience signal worth repeating",
      summary: `${byEngagement[0].title} has the strongest engagement rate in the current dataset.`,
      recommendation:
        "Review its comments and intro structure to identify what made viewers react, then reuse that format.",
      confidence: 0.79,
      sourceVideoIds: [byEngagement[0].id]
    },
    {
      id: "generated-growth",
      type: "growth",
      title: "Packaging pattern with reach",
      summary: `${byReach[0].title} generated the highest views per subscriber ratio.`,
      recommendation:
        "Treat this as a packaging benchmark and compare future titles, thumbnails, and topics against it.",
      confidence: 0.76,
      sourceVideoIds: [byReach[0].id]
    }
  ];
}
