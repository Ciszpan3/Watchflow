export type ChannelOverview = {
  mode: "demo" | "live";
  channel: {
    id: string;
    title: string;
    description: string;
    thumbnailUrl: string;
    subscriberCount: number;
    viewCount: number;
    videoCount: number;
    lastSyncedAt: string;
  };
  metrics: {
    averageViewsPerVideo: number;
    subscriberToViewRatio: number;
    engagementRate: number;
    changes: {
      views: number;
      subscribers: number;
      engagement: number;
      averageViews: number;
    };
    syncState: string;
  };
  trend: Array<{ date: string; views: number; engagementRate: number }>;
};

export type Video = {
  id: string;
  title: string;
  publishedAt: string;
  thumbnailUrl: string;
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
};
