import { Router } from "express";
import { demoVideos } from "../data/demoData.js";
import { sortVideos } from "../services/metrics.js";

export const videosRouter = Router();

videosRouter.get("/", (req, res) => {
  const sort = String(req.query.sort ?? "opportunity");
  const order = String(req.query.order ?? "desc");
  res.json({
    mode: "demo",
    sort,
    order: order === "asc" ? "asc" : "desc",
    videos: sortVideos(demoVideos, sort, order)
  });
});
