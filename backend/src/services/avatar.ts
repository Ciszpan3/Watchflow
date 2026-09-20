import { db } from "../db.js";

const maxAvatarBytes = 1024 * 1024;
const trustedGoogleHosts = ["googleusercontent.com", "ggpht.com"];

export function isTrustedAvatarUrl(value: string) {
  try {
    const url = new URL(value);
    return url.protocol === "https:" && trustedGoogleHosts.some((host) => url.hostname === host || url.hostname.endsWith(`.${host}`));
  } catch {
    return false;
  }
}

export async function loadAvatar(userId: string) {
  const user = await db.user.findUnique({
    where: { id: userId },
    select: { avatarUrl: true, avatarData: true, avatarMimeType: true }
  });
  if (!user) return null;
  if (user.avatarData && user.avatarMimeType) return { data: user.avatarData, mimeType: user.avatarMimeType };
  if (!user.avatarUrl || !isTrustedAvatarUrl(user.avatarUrl)) return null;

  const response = await fetch(user.avatarUrl, { signal: AbortSignal.timeout(5_000) });
  if (!response.ok) return null;
  const mimeType = response.headers.get("content-type")?.split(";")[0]?.trim().toLowerCase() ?? "";
  const announcedLength = Number(response.headers.get("content-length") ?? 0);
  if (!mimeType.startsWith("image/") || announcedLength > maxAvatarBytes) return null;
  const bytes = Buffer.from(await response.arrayBuffer());
  if (!bytes.length || bytes.length > maxAvatarBytes) return null;
  await db.user.update({ where: { id: userId }, data: { avatarData: bytes, avatarMimeType: mimeType } });
  return { data: bytes, mimeType };
}
