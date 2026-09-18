import { Router } from "express";

export const syncRouter = Router();

syncRouter.post("/channel", (_req, res) => {
  res.status(202).json({
    mode: "demo",
    status: "queued",
    message:
      "Demo sync accepted. Real YouTube synchronization will run after OAuth token persistence and PostgreSQL storage are wired."
  });
});
