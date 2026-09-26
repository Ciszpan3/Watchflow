import { Router } from "express";
import { db } from "../db.js";
import { getAuthUser, optionalAuth, requireAuth } from "../middleware/auth.js";
import { serializeVideo } from "../services/recommendations.js";

export const queueRouter = Router();
queueRouter.use(optionalAuth, requireAuth);

export const queueSortOptions = ["saved_newest", "saved_oldest", "published_newest", "published_oldest", "shortest", "longest"] as const;
type QueueSort = typeof queueSortOptions[number];

function queueComparator(sort: QueueSort) {
  const value = (item: { createdAt: Date; video: { publishedAt: Date | null; durationSeconds: number } }) => {
    if (sort.startsWith("saved")) return item.createdAt.getTime();
    if (sort.startsWith("published")) return item.video.publishedAt?.getTime() ?? 0;
    return item.video.durationSeconds;
  };
  const direction = sort === "saved_oldest" || sort === "published_oldest" || sort === "shortest" ? 1 : -1;
  return (left: Parameters<typeof value>[0], right: Parameters<typeof value>[0]) => {
    if (sort.startsWith("published")) {
      if (!left.video.publishedAt) return 1;
      if (!right.video.publishedAt) return -1;
    }
    return (value(left) - value(right)) * direction;
  };
}

export function sortQueueRecords<T extends { createdAt: Date; video: { publishedAt: Date | null; durationSeconds: number } }>(items: T[], sort: QueueSort) {
  return [...items].sort(queueComparator(sort));
}

queueRouter.get("/", async (req, res, next) => {
  try {
    const userId = getAuthUser(req).id;
    const sort = String(req.query.sort ?? "saved_newest") as QueueSort;
    if (!queueSortOptions.includes(sort)) {
      res.status(422).json({ error: "invalid_queue_sort", message: "Queue sort option is not supported." });
      return;
    }
    const saved = await db.savedVideo.findMany({
      where: { userId },
      include: { video: { include: { channel: true } } }
    });
    const subscriptions = await db.subscription.findMany({ where: { userId }, select: { channelId: true } });
    const subscribed = new Set(subscriptions.map((item) => item.channelId));
    res.json({
      items: sortQueueRecords(saved, sort).map((item) => ({
        ...serializeVideo(item.video, subscribed.has(item.video.channelId) ? "subscribed" : "new"),
        savedAt: item.createdAt.toISOString()
      }))
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
