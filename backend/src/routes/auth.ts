import { Router, type Request } from "express";
import { env } from "../config/env.js";
import { db } from "../db.js";
import { type AuthenticatedRequest, optionalAuth, requireAuth } from "../middleware/auth.js";
import { createAuthUrl, createOAuthClient, preserveRefreshToken } from "../services/googleOAuth.js";
import { encryptSecret, randomToken, tokensEqual } from "../services/security.js";
import { createSession, deleteSession, sessionCookieOptions } from "../services/sessions.js";
import { exchangeCodeForTokens } from "../services/youtube.js";
import { profileCreateData, serializeProfile } from "../viewer/profile.js";

export const authRouter = Router();
const oauthStateCookie = "watchflow_oauth_state";

function sessionPayload(req: Request) {
  const user = (req as Request & { authUser?: AuthenticatedRequest["authUser"] }).authUser;
  if (!user) return { authenticated: false as const };
  return {
    authenticated: true as const,
    user: {
      id: user.id,
      displayName: user.displayName,
      email: user.email,
      avatarUrl: user.avatarUrl
    },
    youtube: {
      connected: Boolean(user.googleAccount?.encryptedRefreshToken) && !user.googleAccount?.needsReconnect,
      needsReconnect: Boolean(user.googleAccount?.needsReconnect),
      lastSyncedAt: user.googleAccount?.lastSyncedAt?.toISOString() ?? null
    },
    profile: user.profile ? serializeProfile(user.profile) : null
  };
}

authRouter.get("/google", (_req, res) => {
  const state = randomToken(24);
  const authUrl = createAuthUrl(state);
  if (!authUrl) {
    res.status(503).json({
      error: "oauth_not_configured",
      message: "Set GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, and GOOGLE_REDIRECT_URI in backend/.env."
    });
    return;
  }
  res.cookie(oauthStateCookie, state, { ...sessionCookieOptions, maxAge: 10 * 60 * 1000 });
  res.redirect(authUrl);
});

authRouter.get("/google/callback", async (req, res) => {
  const resultUrl = new URL("/", env.clientOrigin);
  try {
    const code = String(req.query.code ?? "");
    const state = String(req.query.state ?? "");
    const expectedState = String(req.cookies?.[oauthStateCookie] ?? "");
    res.clearCookie(oauthStateCookie, sessionCookieOptions);

    if (!code || !state || !expectedState || !tokensEqual(state, expectedState)) {
      resultUrl.searchParams.set("oauth", "error");
      resultUrl.searchParams.set("reason", "invalid_state");
      res.redirect(resultUrl.toString());
      return;
    }

    const tokens = await exchangeCodeForTokens(code);
    if (!tokens.id_token) throw new Error("Google did not return an ID token");
    const oauthClient = createOAuthClient();
    const ticket = await oauthClient.verifyIdToken({ idToken: tokens.id_token, audience: env.googleClientId });
    const identity = ticket.getPayload();
    if (!identity?.sub || !identity.email || identity.email_verified === false) {
      throw new Error("Google account identity is incomplete or unverified");
    }

    const user = await db.user.upsert({
      where: { googleSubject: identity.sub },
      update: {
        email: identity.email,
        displayName: identity.name ?? identity.email.split("@")[0],
        avatarUrl: identity.picture ?? null
      },
      create: {
        googleSubject: identity.sub,
        email: identity.email,
        displayName: identity.name ?? identity.email.split("@")[0],
        avatarUrl: identity.picture ?? null,
        profile: { create: profileCreateData() }
      },
      include: { googleAccount: true }
    });

    const encryptedRefreshToken = preserveRefreshToken(
      tokens.refresh_token ? encryptSecret(tokens.refresh_token) : null,
      user.googleAccount?.encryptedRefreshToken
    );
    await db.googleAccount.upsert({
      where: { userId: user.id },
      update: {
        encryptedRefreshToken,
        scopes: tokens.scope?.split(" ").filter(Boolean) ?? user.googleAccount?.scopes ?? [],
        needsReconnect: !encryptedRefreshToken,
        connectedAt: new Date()
      },
      create: {
        userId: user.id,
        encryptedRefreshToken,
        scopes: tokens.scope?.split(" ").filter(Boolean) ?? [],
        needsReconnect: !encryptedRefreshToken
      }
    });

    await createSession(user.id, res);
    resultUrl.searchParams.set("oauth", "success");
    res.redirect(resultUrl.toString());
  } catch (error) {
    console.error("OAuth callback failed", error);
    resultUrl.searchParams.set("oauth", "error");
    resultUrl.searchParams.set("reason", "callback_failed");
    res.redirect(resultUrl.toString());
  }
});

authRouter.get("/session", optionalAuth, (req, res) => {
  res.json(sessionPayload(req));
});

authRouter.post("/logout", async (req, res, next) => {
  try {
    await deleteSession(req.cookies?.[env.sessionCookieName], res);
    res.status(204).end();
  } catch (error) {
    next(error);
  }
});

authRouter.delete("/youtube", optionalAuth, requireAuth, async (req, res, next) => {
  try {
    const user = (req as AuthenticatedRequest).authUser;
    const account = user.googleAccount;
    if (account?.encryptedRefreshToken) {
      try {
        const { decryptSecret } = await import("../services/security.js");
        await createOAuthClient().revokeToken(decryptSecret(account.encryptedRefreshToken));
      } catch (error) {
        console.warn("Google token revocation failed; local credentials will still be removed", error);
      }
    }
    await db.$transaction([
      db.userVideoCandidate.deleteMany({ where: { userId: user.id } }),
      db.subscription.deleteMany({ where: { userId: user.id } }),
      db.likedVideo.deleteMany({ where: { userId: user.id } }),
      db.googleAccount.update({
        where: { userId: user.id },
        data: { encryptedRefreshToken: null, needsReconnect: false, lastSyncedAt: null }
      })
    ]);
    res.status(204).end();
  } catch (error) {
    next(error);
  }
});
