import { Router } from "express";
import { env } from "../config/env.js";
import { createAuthUrl } from "../services/googleOAuth.js";
import { exchangeCodeForTokens } from "../services/youtube.js";

export const authRouter = Router();

authRouter.get("/google", (_req, res) => {
  const authUrl = createAuthUrl();

  if (!authUrl) {
    res.status(503).json({
      error: "Google OAuth is not configured",
      message: "Set GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, and GOOGLE_REDIRECT_URI in .env."
    });
    return;
  }

  res.redirect(authUrl);
});

authRouter.get("/google/callback", async (req, res, next) => {
  try {
    const code = String(req.query.code ?? "");

    if (!code) {
      res.status(400).json({ error: "Missing OAuth code" });
      return;
    }

    const tokens = await exchangeCodeForTokens(code);
    const hasRefreshToken = Boolean(tokens.refresh_token);
    const resultUrl = new URL("/connected", env.clientOrigin);
    resultUrl.searchParams.set("status", "success");
    resultUrl.searchParams.set("refreshToken", hasRefreshToken ? "present" : "missing");

    res.redirect(resultUrl.toString());
  } catch (error) {
    next(error);
  }
});
