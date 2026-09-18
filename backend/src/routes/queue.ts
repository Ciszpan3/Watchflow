import { Router } from "express";
import { db } from "../db.js";
import { getAuthUser, optionalAuth, requireAuth } from "../middleware/auth.js";
import { serializeVideo } from "../services/recommendations.js";

export const queueRouter = Router();
queueRouter.use(optionalAuth, requireAuth);

queueRouter.get("/", async (req, res, next) => {
  try {
    const userId = getAuthUser(req).id;
    const saved = await db.savedVideo.findMany({
      where: { userId },
      orderBy: { createdAt: "desc" },
      include: { video: { include: { channel: true } } }
    });
    const subscriptions = await db.subscription.findMany({ where: { userId }, select: { channelId: true } });
    const subscribed = new Set(subscriptions.map((item) => item.channelId));
    res.json({
      items: saved.map((item) => serializeVideo(item.video, subscribed.has(item.video.channelId) ? "subscribed" : "new"))
    });
  } catch (error) {
    next(error);
  }
});

queueRouter.post("/", async (req, res, next) => {
  try {
    const userId = getAuthUser(req).id;
    const videoId = String(req.body?.videoId ?? "");
    if (!videoId || !(await db.video.findUnique({ where: { id: videoId }, select: { id: true } }))) {
      res.status(404).json({ error: "video_not_found", message: "The requested video is not available in Watchflow." });
      return;
    }
    await db.$transaction([
      db.savedVideo.upsert({ where: { userId_videoId: { userId, videoId } }, update: {}, create: { userId, videoId } }),
      db.viewingActivity.create({ data: { userId, videoId, type: "SAVED" } })
    ]);
    res.status(201).json({ videoId, saved: true });
  } catch (error) {
    next(error);
  }
});

queueRouter.delete("/:videoId", async (req, res, next) => {
  try {
    const userId = getAuthUser(req).id;
    const videoId = req.params.videoId;
    await db.$transaction([
      db.savedVideo.deleteMany({ where: { userId, videoId } }),
      db.viewingActivity.create({ data: { userId, videoId, type: "UNSAVED" } })
    ]);
    res.status(204).end();
  } catch (error) {
    next(error);
  }
});
