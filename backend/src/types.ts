export type ChannelSummary = {
  id: string;
  title: string;
  description: string;
  thumbnailUrl: string;
  subscriberCount: number;
  viewCount: number;
  videoCount: number;
  lastSyncedAt: string;
};

export type VideoPerformance = {
  id: string;
  title: string;
  publishedAt: string;
  thumbnailUrl: string;
  durationSeconds: number;
  views: number;
  likes: number;
  comments: number;
  engagementRate: number;
  viewsPerSubscriber: number;
  opportunityScore: number;
};

export type Insight = {
  id: string;
  type: "growth" | "content" | "audience" | "opportunity";
  title: string;
  summary: string;
  recommendation: string;
  confidence: number;
  sourceVideoIds: string[];
};

export type TrendPoint = {
  date: string;
  views: number;
  engagementRate: number;
};
