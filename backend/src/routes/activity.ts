import { Router } from "express";
import { db } from "../db.js";
import { getAuthUser, optionalAuth, requireAuth } from "../middleware/auth.js";
import { buildContentDiet } from "../services/viewerActivity.js";

export const activityRouter = Router();
activityRouter.use(optionalAuth, requireAuth);

activityRouter.get("/", async (req, res, next) => {
  try {
    const userId = getAuthUser(req).id;
    const [watched, subscriptions] = await Promise.all([
      db.watchedVideo.findMany({ where: { userId }, orderBy: { watchedAt: "desc" }, include: { video: true } }),
      db.subscription.findMany({ where: { userId }, select: { channelId: true } })
    ]);
    res.json({
      watchedVideoIds: watched.map((item) => item.videoId),
      diet: buildContentDiet(watched, new Set(subscriptions.map((item) => item.channelId)))
    });
  } catch (error) {
    next(error);
  }
});

activityRouter.put("/watched/:videoId", async (req, res, next) => {
  try {
    const userId = getAuthUser(req).id;
    const videoId = req.params.videoId;
    if (!(await db.video.findUnique({ where: { id: videoId }, select: { id: true } }))) {
      res.status(404).json({ error: "video_not_found", message: "This video is not available in Watchflow." });
      return;
    }
    const watched = await db.watchedVideo.upsert({
      where: { userId_videoId: { userId, videoId } },
      update: { watchedAt: new Date() },
      create: { userId, videoId }
    });
    res.json({ videoId, watched: true, watchedAt: watched.watchedAt.toISOString() });
  } catch (error) {
    next(error);
  }
});

activityRouter.delete("/watched/:videoId", async (req, res, next) => {
  try {
    await db.watchedVideo.deleteMany({ where: { userId: getAuthUser(req).id, videoId: req.params.videoId } });
    res.status(204).end();
  } catch (error) {
    next(error);
  }
});
