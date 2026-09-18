import cookieParser from "cookie-parser";
import cors from "cors";
import express from "express";
import { env } from "./config/env.js";
import { authRouter } from "./routes/auth.js";
import { channelRouter } from "./routes/channel.js";
import { insightsRouter } from "./routes/insights.js";
import { queueRouter } from "./routes/queue.js";
import { recommendationsRouter } from "./routes/recommendations.js";
import { syncRouter } from "./routes/sync.js";
import { videosRouter } from "./routes/videos.js";
import { viewerRouter } from "./routes/viewer.js";

export const app = express();

app.use(cors({
  credentials: true,
  origin(origin, callback) {
    const isConfiguredOrigin = origin === env.clientOrigin;
    const isLocalDevelopment = env.nodeEnv !== "production" && Boolean(origin && /^http:\/\/(localhost|127\.0\.0\.1):\d+$/.test(origin));
    callback(null, !origin || isConfiguredOrigin || isLocalDevelopment);
  }
}));
app.use(cookieParser());
app.use(express.json({ limit: "64kb" }));

app.get("/health", (_req, res) => {
  res.json({ status: "ok", service: "watchflow-api" });
});

app.use("/api/auth", authRouter);
app.use("/api/viewer", viewerRouter);
app.use("/api/recommendations", recommendationsRouter);
app.use("/api/queue", queueRouter);

// Legacy creator-demo endpoints remain isolated from the viewer-first live flow.
app.use("/api/channel", channelRouter);
app.use("/api/videos", videosRouter);
app.use("/api/insights", insightsRouter);
app.use("/api/sync", syncRouter);

app.use((error: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  console.error(error);
  res.status(500).json({
    error: "internal_error",
    message: env.nodeEnv === "production" ? "Unexpected server error." : error instanceof Error ? error.message : "Unknown error"
  });
});
