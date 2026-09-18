import "dotenv/config";

export const env = {
  nodeEnv: process.env.NODE_ENV ?? "development",
  port: Number(process.env.PORT ?? 4000),
  clientOrigin: process.env.CLIENT_ORIGIN ?? "http://localhost:5173",
  databaseUrl: process.env.DATABASE_URL ?? "",
  googleClientId: process.env.GOOGLE_CLIENT_ID ?? "",
  googleClientSecret: process.env.GOOGLE_CLIENT_SECRET ?? "",
  googleRedirectUri:
    process.env.GOOGLE_REDIRECT_URI ?? "http://localhost:4000/api/auth/google/callback",
  youtubeApiKey: process.env.YOUTUBE_API_KEY ?? "",
  openAiApiKey: process.env.OPENAI_API_KEY ?? "",
  tokenEncryptionKey: process.env.TOKEN_ENCRYPTION_KEY ?? "",
  sessionCookieName: process.env.SESSION_COOKIE_NAME ?? "watchflow_session",
  sessionTtlDays: Number(process.env.SESSION_TTL_DAYS ?? 30),
  syncCacheHours: Number(process.env.SYNC_CACHE_HOURS ?? 6),
  syncCooldownMinutes: Number(process.env.SYNC_COOLDOWN_MINUTES ?? 15),
  searchCacheHours: Number(process.env.SEARCH_CACHE_HOURS ?? 12),
  searchDailyLimit: Number(process.env.SEARCH_DAILY_LIMIT ?? 80)
};

export function hasGoogleOAuthConfig() {
  return Boolean(env.googleClientId && env.googleClientSecret && env.googleRedirectUri);
}
