import type { Response } from "express";
import { env } from "../config/env.js";
import { db } from "../db.js";
import { hashToken, randomToken } from "./security.js";

export const sessionCookieOptions = {
  httpOnly: true,
  sameSite: "lax" as const,
  secure: env.nodeEnv === "production",
  path: "/"
};

export async function createSession(userId: string, response: Response) {
  const token = randomToken();
  const expiresAt = new Date(Date.now() + env.sessionTtlDays * 24 * 60 * 60 * 1000);
  await db.authSession.create({
    data: { userId, tokenHash: hashToken(token), expiresAt }
  });
  response.cookie(env.sessionCookieName, token, { ...sessionCookieOptions, expires: expiresAt });
}

export async function deleteSession(token: string | undefined, response: Response) {
  if (token) {
    await db.authSession.deleteMany({ where: { tokenHash: hashToken(token) } });
  }
  response.clearCookie(env.sessionCookieName, sessionCookieOptions);
}

export async function resolveSession(token: string | undefined) {
  if (!token) return null;
  const session = await db.authSession.findUnique({
    where: { tokenHash: hashToken(token) },
    include: { user: { include: { googleAccount: true, profile: true } } }
  });
  if (!session || session.expiresAt <= new Date()) {
    if (session) await db.authSession.delete({ where: { id: session.id } });
    return null;
  }
  void db.authSession.update({ where: { id: session.id }, data: { lastSeenAt: new Date() } });
  return session;
}
