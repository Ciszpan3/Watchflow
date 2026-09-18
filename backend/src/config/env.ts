import "dotenv/config";

export const env = {
  port: Number(process.env.PORT ?? 4000),
  clientOrigin: process.env.CLIENT_ORIGIN ?? "http://localhost:5173",
  databaseUrl: process.env.DATABASE_URL ?? "",
  googleClientId: process.env.GOOGLE_CLIENT_ID ?? "",
  googleClientSecret: process.env.GOOGLE_CLIENT_SECRET ?? "",
  googleRedirectUri:
    process.env.GOOGLE_REDIRECT_URI ?? "http://localhost:4000/api/auth/google/callback",
  youtubeApiKey: process.env.YOUTUBE_API_KEY ?? "",
  openAiApiKey: process.env.OPENAI_API_KEY ?? ""
};

export function hasGoogleOAuthConfig() {
  return Boolean(env.googleClientId && env.googleClientSecret && env.googleRedirectUri);
}
