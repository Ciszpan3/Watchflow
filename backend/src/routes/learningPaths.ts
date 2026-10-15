import { Router } from "express";
import type { Prisma } from "../generated/prisma/client.js";
import { db } from "../db.js";
import { getAuthUser, optionalAuth, requireAuth } from "../middleware/auth.js";
import { serializeVideo } from "../services/recommendations.js";

export const learningPathsRouter = Router();
learningPathsRouter.use(optionalAuth, requireAuth);

type PathRecord = Prisma.LearningPathGetPayload<{
  include: { items: { include: { video: { include: { channel: true } } } } };
}>;

function serializePath(path: PathRecord, subscribed: Set<string>, watched: Map<string, Date>) {
  return {
    id: path.id,
    title: path.title,
    topic: path.topic,
    createdAt: path.createdAt.toISOString(),
    updatedAt: path.updatedAt.toISOString(),
    items: path.items.sort((left, right) => left.position - right.position).map((item) => ({
      id: item.id,
      position: item.position,
      addedAt: item.createdAt.toISOString(),
      watched: watched.has(item.videoId),
      watchedAt: watched.get(item.videoId)?.toISOString() ?? null,
      video: serializeVideo(item.video, subscribed.has(item.video.channelId) ? "subscribed" : "new")
    }))
  };
}

async function pathContext(userId: string) {
  const [subscriptions, watched] = await Promise.all([
    db.subscription.findMany({ where: { userId }, select: { channelId: true } }),
    db.watchedVideo.findMany({ where: { userId }, select: { videoId: true, watchedAt: true } })
  ]);
  return {
    subscribed: new Set(subscriptions.map((item) => item.channelId)),
    watched: new Map(watched.map((item) => [item.videoId, item.watchedAt]))
  };
}

async function findPath(userId: string, pathId: string) {
  return db.learningPath.findFirst({
    where: { id: pathId, userId },
    include: { items: { include: { video: { include: { channel: true } } } } }
  });
}

learningPathsRouter.get("/", async (req, res, next) => {
  try {
    const userId = getAuthUser(req).id;
    const [paths, context] = await Promise.all([
      db.learningPath.findMany({
        where: { userId },
        orderBy: { updatedAt: "desc" },
        include: { items: { include: { video: { include: { channel: true } } } } }
      }),
      pathContext(userId)
    ]);
    res.json({ items: paths.map((path) => serializePath(path, context.subscribed, context.watched)) });
  } catch (error) {
    next(error);
  }
});

learningPathsRouter.post("/", async (req, res, next) => {
  try {
    const userId = getAuthUser(req).id;
    const title = typeof req.body?.title === "string" ? req.body.title.trim() : "";
    const topic = typeof req.body?.topic === "string" ? req.body.topic.trim() : "";
    if (title.length < 3 || title.length > 80 || topic.length > 50) {
      res.status(422).json({ error: "invalid_learning_path", message: "Use a title between 3 and 80 characters." });
      return;
    }
    if (await db.learningPath.count({ where: { userId } }) >= 20) {
      res.status(409).json({ error: "learning_path_limit", message: "You can keep up to 20 learning paths." });
      return;
    }
    const created = await db.learningPath.create({
      data: { userId, title, topic: topic || null },
      include: { items: { include: { video: { include: { channel: true } } } } }
    });
    res.status(201).json({ path: serializePath(created, new Set(), new Map()) });
  } catch (error) {
    next(error);
  }
});

learningPathsRouter.delete("/:pathId", async (req, res, next) => {
  try {
    await db.learningPath.deleteMany({ where: { id: req.params.pathId, userId: getAuthUser(req).id } });
    res.status(204).end();
  } catch (error) {
    next(error);
  }
});

learningPathsRouter.post("/:pathId/items", async (req, res, next) => {
  try {
    const userId = getAuthUser(req).id;
    const videoId = typeof req.body?.videoId === "string" ? req.body.videoId : "";
    const path = await findPath(userId, req.params.pathId);
    if (!path) {
      res.status(404).json({ error: "learning_path_not_found", message: "This learning path does not exist." });
      return;
    }
    if (!videoId || !(await db.video.findUnique({ where: { id: videoId }, select: { id: true } }))) {
      res.status(404).json({ error: "video_not_found", message: "This video is not available in Watchflow." });
      return;
    }
    if (path.items.length >= 20) {
      res.status(409).json({ error: "learning_path_item_limit", message: "A learning path can contain up to 20 videos." });
      return;
    }
    await db.learningPathItem.upsert({
      where: { pathId_videoId: { pathId: path.id, videoId } },
      update: {},
      create: { pathId: path.id, videoId, position: path.items.reduce((highest, item) => Math.max(highest, item.position), -1) + 1 }
    });
    const [updated, context] = await Promise.all([findPath(userId, path.id), pathContext(userId)]);
    res.status(201).json({ path: serializePath(updated!, context.subscribed, context.watched) });
  } catch (error) {
    next(error);
  }
});

learningPathsRouter.delete("/:pathId/items/:videoId", async (req, res, next) => {
  try {
    const userId = getAuthUser(req).id;
    const path = await db.learningPath.findFirst({ where: { id: req.params.pathId, userId }, select: { id: true } });
    if (!path) {
      res.status(404).json({ error: "learning_path_not_found", message: "This learning path does not exist." });
      return;
    }
    await db.learningPathItem.deleteMany({ where: { pathId: path.id, videoId: req.params.videoId } });
    res.status(204).end();
  } catch (error) {
    next(error);
  }
});
