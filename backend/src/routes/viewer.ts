import { Router } from "express";
import { env } from "../config/env.js";
import { db } from "../db.js";
import { type AuthenticatedRequest, optionalAuth, requireAuth } from "../middleware/auth.js";
import { deleteSession } from "../services/sessions.js";
import { requestViewerSync } from "../services/viewerSync.js";
import { serializeFeedback } from "../services/feedback.js";
import { isProfileInput, isRecommendationRequest, isWatchHistoryImportItem, type WatchHistoryImportItem } from "../viewer/contracts.js";
import { getOrCreateProfile, profileCreateData, serializeProfile } from "../viewer/profile.js";
import { classifyTopicsFromText } from "../services/classification.js";

export const viewerRouter = Router();
viewerRouter.use(optionalAuth, requireAuth);

viewerRouter.get("/profile", async (req, res, next) => {
  try {
    const profile = await getOrCreateProfile((req as AuthenticatedRequest).authUser.id);
    res.json({ profile: serializeProfile(profile), source: profile.createdAt.getTime() === profile.updatedAt.getTime() ? "default" : "persisted" });
  } catch (error) {
    next(error);
  }
});

viewerRouter.put("/profile", async (req, res, next) => {
  try {
    if (!isProfileInput(req.body)) {
      res.status(422).json({ error: "invalid_profile", message: "Viewer profile has invalid fields." });
      return;
    }
    const userId = (req as AuthenticatedRequest).authUser.id;
    const profile = await db.viewerProfile.upsert({
      where: { userId },
      update: profileCreateData(req.body),
      create: { userId, ...profileCreateData(req.body) }
    });
    res.json({ profile: serializeProfile(profile), source: "persisted" });
  } catch (error) {
    next(error);
  }
});

viewerRouter.get("/history", async (req, res, next) => {
  try {
    const userId = (req as AuthenticatedRequest).authUser.id;
    const [items, latest] = await Promise.all([
      db.watchHistoryItem.findMany({ where: { userId }, orderBy: { watchedAt: "desc" }, take: 5000 }),
      db.watchHistoryItem.findFirst({ where: { userId }, orderBy: { importedAt: "desc" }, select: { importedAt: true } })
    ]);
    res.json({
      count: items.length,
      importedAt: latest?.importedAt.toISOString() ?? null,
      items: items.map((item) => ({ videoId: item.videoId, title: item.title, channelTitle: item.channelTitle, watchedAt: item.watchedAt.toISOString() }))
    });
  } catch (error) {
    next(error);
  }
});

viewerRouter.post("/history/import", async (req, res, next) => {
  try {
    const rawItems = Array.isArray(req.body?.items) ? req.body.items : [];
    if (!rawItems.length || rawItems.length > 5000 || !rawItems.every(isWatchHistoryImportItem)) {
      res.status(422).json({ error: "invalid_watch_history", message: "Upload a valid Google Takeout watch-history file with up to 5000 entries." });
      return;
    }
    const seen = new Set<string>();
    const items = (rawItems as WatchHistoryImportItem[])
      .map((item) => ({
        ...item,
        videoId: item.videoId && /^[A-Za-z0-9_-]{6,32}$/.test(item.videoId) ? item.videoId : null,
        title: item.title.trim().slice(0, 300),
        channelTitle: item.channelTitle?.trim().slice(0, 200) || null,
        watchedAt: new Date(item.watchedAt)
      }))
      .filter((item) => {
        const key = `${item.videoId ?? item.title}|${item.watchedAt.toISOString()}`;
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      });
    const userId = (req as AuthenticatedRequest).authUser.id;
    await db.$transaction([
      db.watchHistoryItem.deleteMany({ where: { userId } }),
      db.watchHistoryItem.createMany({ data: items.map((item) => ({
        userId,
        videoId: item.videoId,
        title: item.title,
        channelTitle: item.channelTitle,
        watchedAt: item.watchedAt,
        topics: classifyTopicsFromText(`${item.title} ${item.channelTitle ?? ""}`)
      })) })
    ]);
    res.json({ count: items.length, importedAt: new Date().toISOString() });
  } catch (error) {
    next(error);
  }
});

viewerRouter.delete("/history", async (req, res, next) => {
  try {
    await db.watchHistoryItem.deleteMany({ where: { userId: (req as AuthenticatedRequest).authUser.id } });
    res.status(204).end();
  } catch (error) {
    next(error);
  }
});

viewerRouter.get("/feedback", async (req, res, next) => {
  try {
    const rows = await db.recommendationFeedback.findMany({
      where: { userId: (req as AuthenticatedRequest).authUser.id },
      orderBy: { updatedAt: "desc" },
      include: { video: { include: { channel: true } } }
    });
    res.json({ items: rows.map(serializeFeedback) });
  } catch (error) {
    next(error);
  }
});

viewerRouter.delete("/feedback", async (req, res, next) => {
  try {
    await db.recommendationFeedback.deleteMany({ where: { userId: (req as AuthenticatedRequest).authUser.id } });
    res.status(204).end();
  } catch (error) {
    next(error);
  }
});

viewerRouter.get("/session-draft", async (req, res, next) => {
  try {
    const draft = await db.viewerSessionDraft.findUnique({
      where: { userId: (req as AuthenticatedRequest).authUser.id }
    });
    res.json({ request: draft?.request ?? null, updatedAt: draft?.updatedAt.toISOString() ?? null });
  } catch (error) {
    next(error);
  }
});

viewerRouter.put("/session-draft", async (req, res, next) => {
  try {
    if (!isRecommendationRequest(req.body)) {
      res.status(422).json({ error: "invalid_session_request", message: "Recommendation filters are invalid." });
      return;
    }
    const draft = await db.viewerSessionDraft.upsert({
      where: { userId: (req as AuthenticatedRequest).authUser.id },
      update: { request: req.body },
      create: { userId: (req as AuthenticatedRequest).authUser.id, request: req.body }
    });
    res.json({ request: draft.request, updatedAt: draft.updatedAt.toISOString() });
  } catch (error) {
    next(error);
  }
});

viewerRouter.get("/signals", async (req, res, next) => {
  try {
    const user = (req as AuthenticatedRequest).authUser;
    const [subscriptions, likedVideos, history, latestHistory, latestJob, account, profile] = await Promise.all([
      db.subscription.count({ where: { userId: user.id } }),
      db.likedVideo.count({ where: { userId: user.id } }),
      db.watchHistoryItem.count({ where: { userId: user.id } }),
      db.watchHistoryItem.findFirst({ where: { userId: user.id }, orderBy: { importedAt: "desc" }, select: { importedAt: true } }),
      db.syncJob.findFirst({ where: { userId: user.id }, orderBy: { startedAt: "desc" } }),
      db.googleAccount.findUnique({ where: { userId: user.id } }),
      db.viewerProfile.findUnique({ where: { userId: user.id }, select: { useWatchHistory: true } })
    ]);
    const lastSyncedAt = account?.lastSyncedAt ?? null;
    const stale = !lastSyncedAt || Date.now() - lastSyncedAt.getTime() > env.syncCacheHours * 60 * 60 * 1000;
    res.json({
      mode: "live",
      connected: Boolean(account?.encryptedRefreshToken) && !account?.needsReconnect,
      needsReconnect: Boolean(account?.needsReconnect),
      stale,
      lastSyncedAt: lastSyncedAt?.toISOString() ?? null,
      subscriptions: {
        state: account?.needsReconnect ? "error" : subscriptions ? "ready" : "pending",
        count: subscriptions,
        detail: subscriptions ? `${subscriptions} subscribed channels imported.` : "Waiting for the first YouTube sync."
      },
      likedVideos: {
        state: account?.needsReconnect ? "error" : likedVideos ? "ready" : "pending",
        count: likedVideos,
        detail: likedVideos ? `${likedVideos} liked videos used as taste signals.` : "Waiting for the first YouTube sync."
      },
      watchHistory: {
        state: profile?.useWatchHistory ? (history ? "ready" : "available") : "disabled",
        count: history,
        importedAt: latestHistory?.importedAt.toISOString() ?? null,
        detail: profile?.useWatchHistory
          ? history ? `${history} imported history entries used as taste signals.` : "Import Google Takeout watch history to use this signal."
          : "Watch history is imported manually and is currently disabled in your profile."
      },
      watchLater: { state: "unavailable", detail: "YouTube does not expose Watch Later items through the Data API." },
      sync: latestJob ? {
        id: latestJob.id,
        status: latestJob.status.toLowerCase(),
        phase: latestJob.phase,
        subscriptionsCount: latestJob.subscriptionsCount,
        likedVideosCount: latestJob.likedVideosCount,
        candidatesCount: latestJob.candidatesCount,
        errorCode: latestJob.errorCode,
        errorMessage: latestJob.errorMessage,
        startedAt: latestJob.startedAt.toISOString(),
        finishedAt: latestJob.finishedAt?.toISOString() ?? null
      } : null
    });
  } catch (error) {
    next(error);
  }
});

viewerRouter.post("/sync", async (req, res, next) => {
  try {
    const result = await requestViewerSync((req as AuthenticatedRequest).authUser.id, req.query.force === "true");
    if (result.status === "reconnect_required") {
      res.status(401).json({ error: result.status, message: "Reconnect YouTube before synchronizing." });
      return;
    }
    if (result.status === "cooldown") {
      res.status(429).json({ error: result.status, message: "Sync is cooling down.", nextAllowedAt: result.nextAllowedAt });
      return;
    }
    res.status(result.status === "queued" ? 202 : 200).json(result);
  } catch (error) {
    next(error);
  }
});

viewerRouter.delete("/account", async (req, res, next) => {
  try {
    const userId = (req as AuthenticatedRequest).authUser.id;
    await deleteSession(req.cookies?.[env.sessionCookieName], res);
    await db.user.delete({ where: { id: userId } });
    res.status(204).end();
  } catch (error) {
    next(error);
  }
});
