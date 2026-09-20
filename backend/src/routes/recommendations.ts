import { Router } from "express";
import { db } from "../db.js";
import { FeedbackReason } from "../generated/prisma/enums.js";
import { getAuthUser, optionalAuth, requireAuth } from "../middleware/auth.js";
import { buildLiveSession, buildNextLiveSession, getLatestLiveSession } from "../services/recommendations.js";
import { isInvalidGrant } from "../services/youtubeLive.js";
import { isRecommendationRequest } from "../viewer/contracts.js";

export const recommendationsRouter = Router();
recommendationsRouter.use(optionalAuth, requireAuth);

recommendationsRouter.post("/session", async (req, res, next) => {
  try {
    if (!isRecommendationRequest(req.body)) {
      res.status(422).json({ error: "invalid_session_request", message: "Recommendation filters are invalid." });
      return;
    }
    res.json(await buildLiveSession(getAuthUser(req).id, req.body));
  } catch (error) {
    if ((error as { code?: string }).code === "reconnect_required" || isInvalidGrant(error)) {
      await db.googleAccount.updateMany({ where: { userId: getAuthUser(req).id }, data: { needsReconnect: true } });
      res.status(401).json({ error: "reconnect_required", message: "Reconnect YouTube to refresh recommendations." });
      return;
    }
    next(error);
  }
});

recommendationsRouter.get("/session/latest", async (req, res, next) => {
  try {
    res.json({ session: await getLatestLiveSession(getAuthUser(req).id) });
  } catch (error) {
    next(error);
  }
});

recommendationsRouter.post("/session/:sessionId/next", async (req, res, next) => {
  try {
    res.json(await buildNextLiveSession(getAuthUser(req).id, req.params.sessionId));
  } catch (error) {
    if ((error as { code?: string }).code === "session_not_found") {
      res.status(404).json({ error: "session_not_found", message: "Recommendation session was not found." });
      return;
    }
    next(error);
  }
});

const reasonMap: Record<string, FeedbackReason> = {
  already_watched: FeedbackReason.ALREADY_WATCHED,
  not_interested: FeedbackReason.NOT_INTERESTED,
  too_long: FeedbackReason.TOO_LONG,
  too_often: FeedbackReason.TOO_OFTEN
};

recommendationsRouter.post("/:videoId/feedback", async (req, res, next) => {
  try {
    const reason = reasonMap[String(req.body?.reason ?? "")];
    if (!reason) {
      res.status(422).json({ error: "invalid_feedback", message: "Choose a supported feedback reason." });
      return;
    }
    const userId = getAuthUser(req).id;
    const videoId = req.params.videoId;
    await db.recommendationFeedback.upsert({
      where: { userId_videoId: { userId, videoId } },
      update: { reason },
      create: { userId, videoId, reason }
    });
    res.status(204).end();
  } catch (error) {
    next(error);
  }
});

recommendationsRouter.post("/:videoId/opened", async (req, res, next) => {
  try {
    await db.viewingActivity.create({
      data: { userId: getAuthUser(req).id, videoId: req.params.videoId, type: "OPENED" }
    });
    res.status(204).end();
  } catch (error) {
    next(error);
  }
});
