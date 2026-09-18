import type { VideoPerformance } from "../types.js";

export function calculateEngagementRate(views: number, likes: number, comments: number) {
  if (views <= 0) {
    return 0;
  }

  return (likes + comments) / views;
}

export function calculateViewsPerSubscriber(views: number, subscriberCount: number) {
  if (subscriberCount <= 0) {
    return 0;
  }

  return views / subscriberCount;
}

export function calculateOpportunityScore(video: Pick<VideoPerformance, "engagementRate" | "viewsPerSubscriber">) {
  const engagementComponent = Math.min(video.engagementRate / 0.08, 1) * 60;
  const reachComponent = Math.min(video.viewsPerSubscriber / 3, 1) * 40;

  return Math.round(engagementComponent + reachComponent);
}

export function sortVideos(videos: VideoPerformance[], sort = "opportunity", order = "desc") {
  const sorted = [...videos];
  const direction = order === "asc" ? 1 : -1;

  if (sort === "views") {
    return sorted.sort((a, b) => direction * (a.views - b.views));
  }

  if (sort === "engagement") {
    return sorted.sort((a, b) => direction * (a.engagementRate - b.engagementRate));
  }

  if (sort === "recent") {
    return sorted.sort((a, b) => direction * (Date.parse(a.publishedAt) - Date.parse(b.publishedAt)));
  }

  return sorted.sort((a, b) => direction * (a.opportunityScore - b.opportunityScore));
}
