import { Router } from "express";
import { demoChannel, demoTrend } from "../data/demoData.js";

export const channelRouter = Router();

channelRouter.get("/overview", (_req, res) => {
  res.json({
    mode: "demo",
    channel: demoChannel,
    metrics: {
      averageViewsPerVideo: Math.round(demoChannel.viewCount / demoChannel.videoCount),
      subscriberToViewRatio: Number((demoChannel.subscriberCount / demoChannel.viewCount).toFixed(4)),
      engagementRate: 0.074,
      changes: {
        views: 12.8,
        subscribers: 6.4,
        engagement: 1.7,
        averageViews: 9.2
      },
      syncState: "ready"
    },
    trend: demoTrend
  });
});
