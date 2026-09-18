import type { NextFunction, Request, Response } from "express";
import { env } from "../config/env.js";
import { resolveSession } from "../services/sessions.js";

export type SessionUser = NonNullable<Awaited<ReturnType<typeof resolveSession>>>["user"];
export type AuthenticatedRequest = Request & { authUser: SessionUser };

export function getAuthUser(req: Request): SessionUser {
  const authUser = (req as Request & { authUser?: SessionUser }).authUser;
  if (!authUser) {
    throw new Error("Authenticated route reached without a session user.");
  }
  return authUser;
}

export async function optionalAuth(req: Request, _res: Response, next: NextFunction) {
  try {
    const session = await resolveSession(req.cookies?.[env.sessionCookieName]);
    (req as Request & { authUser?: SessionUser }).authUser = session?.user;
    next();
  } catch (error) {
    next(error);
  }
}

export function requireAuth(req: Request, res: Response, next: NextFunction) {
  if (!(req as Request & { authUser?: SessionUser }).authUser) {
    res.status(401).json({ error: "authentication_required", message: "Connect Google to use live Watchflow data." });
    return;
  }
  next();
}
