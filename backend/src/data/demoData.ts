import type { ChannelSummary, Insight, TrendPoint, VideoPerformance } from "../types.js";

export const demoChannel: ChannelSummary = {
  id: "demo-channel",
  title: "Creator Lab Demo",
  description: "Demo channel used when Google OAuth and YouTube API credentials are not configured.",
  thumbnailUrl: "/thumbnails/channel-avatar.png",
  subscriberCount: 18400,
  viewCount: 1420000,
  videoCount: 86,
  lastSyncedAt: new Date().toISOString()
};

export const demoVideos: VideoPerformance[] = [
  {
    id: "vid-1",
    title: "I Rebuilt My Workflow With AI Tools",
    publishedAt: "2026-08-21T10:00:00.000Z",
    thumbnailUrl: "/thumbnails/ai-workflow.png",
    durationSeconds: 892,
    views: 64200,
    likes: 3900,
    comments: 412,
    engagementRate: 0.0672,
    viewsPerSubscriber: 3.49,
    opportunityScore: 91
  },
  {
    id: "vid-2",
    title: "The Honest Setup Tour For Small Creators",
    publishedAt: "2026-07-30T13:30:00.000Z",
    thumbnailUrl: "/thumbnails/setup-tour.png",
    durationSeconds: 728,
    views: 31500,
    likes: 2100,
    comments: 288,
    engagementRate: 0.0758,
    viewsPerSubscriber: 1.71,
    opportunityScore: 86
  },
  {
    id: "vid-3",
    title: "5 Editing Mistakes That Make Videos Feel Slow",
    publishedAt: "2026-07-05T09:15:00.000Z",
    thumbnailUrl: "/thumbnails/editing-mistakes.png",
    durationSeconds: 654,
    views: 22800,
    likes: 1750,
    comments: 169,
    engagementRate: 0.0842,
    viewsPerSubscriber: 1.24,
    opportunityScore: 89
  },
  {
    id: "vid-4",
    title: "Why Your First 30 Seconds Lose Viewers",
    publishedAt: "2026-06-18T16:45:00.000Z",
    thumbnailUrl: "/thumbnails/first-30-seconds.png",
    durationSeconds: 534,
    views: 48900,
    likes: 2500,
    comments: 231,
    engagementRate: 0.0558,
    viewsPerSubscriber: 2.66,
    opportunityScore: 78
  }
];

export const demoTrend: TrendPoint[] = [
  { date: "Aug 23", views: 31800, engagementRate: 0.061 },
  { date: "Aug 26", views: 35400, engagementRate: 0.064 },
  { date: "Aug 29", views: 33200, engagementRate: 0.06 },
  { date: "Sep 1", views: 42100, engagementRate: 0.069 },
  { date: "Sep 4", views: 39800, engagementRate: 0.071 },
  { date: "Sep 7", views: 47600, engagementRate: 0.074 },
  { date: "Sep 10", views: 45200, engagementRate: 0.072 },
  { date: "Sep 13", views: 54100, engagementRate: 0.078 },
  { date: "Sep 16", views: 58700, engagementRate: 0.081 }
];

export const demoInsights: Insight[] = [
  {
    id: "insight-1",
    type: "opportunity",
    title: "High engagement topic with room to scale",
    summary:
      "Editing-focused videos have the highest engagement rate even when total reach is lower than channel average.",
    recommendation:
      "Publish a follow-up editing breakdown and reuse the strongest title pattern from the top-performing video.",
    confidence: 0.87,
    sourceVideoIds: ["vid-3", "vid-4"]
  },
  {
    id: "insight-2",
    type: "audience",
    title: "Viewers respond to practical workflow content",
    summary:
      "Videos framed around concrete workflows drive more comments per view than broad advice videos.",
    recommendation:
      "Create a series around repeatable creator workflows, each focused on one specific pain point.",
    confidence: 0.82,
    sourceVideoIds: ["vid-1", "vid-2"]
  },
  {
    id: "insight-3",
    type: "growth",
    title: "Strong subscriber-relative performance",
    summary:
      "Two recent uploads generated more than 2.5 views per subscriber, a useful signal for packaging and topic fit.",
    recommendation:
      "Turn the best-performing formats into a repeatable monthly segment.",
    confidence: 0.78,
    sourceVideoIds: ["vid-1", "vid-4"]
  }
];
