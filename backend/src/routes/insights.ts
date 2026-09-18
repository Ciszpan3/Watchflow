import { Router } from "express";
import { demoInsights, demoVideos } from "../data/demoData.js";
import { generateDeterministicInsights } from "../services/insights.js";

export const insightsRouter = Router();

insightsRouter.get("/", (_req, res) => {
  res.json({
    mode: "demo",
    insights: demoInsights
  });
});

insightsRouter.post("/generate", (_req, res) => {
  res.json({
    mode: "demo",
    insights: generateDeterministicInsights(demoVideos)
  });
});
