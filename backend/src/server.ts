import cors from "cors";
import express from "express";
import { env } from "./config/env.js";
import { authRouter } from "./routes/auth.js";
import { channelRouter } from "./routes/channel.js";
import { insightsRouter } from "./routes/insights.js";
import { syncRouter } from "./routes/sync.js";
import { videosRouter } from "./routes/videos.js";

const app = express();

app.use(cors({
  origin(origin, callback) {
    const isConfiguredOrigin = origin === env.clientOrigin;
    const isLocalDevelopment = Boolean(origin && /^http:\/\/(localhost|127\.0\.0\.1):\d+$/.test(origin));
    callback(null, !origin || isConfiguredOrigin || isLocalDevelopment);
  }
}));
app.use(express.json());

app.get("/health", (_req, res) => {
  res.json({ status: "ok", service: "watchflow-api" });
});

app.use("/api/auth", authRouter);
app.use("/api/channel", channelRouter);
app.use("/api/videos", videosRouter);
app.use("/api/insights", insightsRouter);
app.use("/api/sync", syncRouter);

app.use((error: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  console.error(error);
  res.status(500).json({
    error: "Internal server error",
    message: error instanceof Error ? error.message : "Unknown error"
  });
});

app.listen(env.port, () => {
  console.log(`Creator dashboard API listening on http://localhost:${env.port}`);
});
