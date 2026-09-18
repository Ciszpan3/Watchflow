import { google } from "googleapis";
import { env, hasGoogleOAuthConfig } from "../config/env.js";

export const youtubeReadonlyScope = "https://www.googleapis.com/auth/youtube.readonly";

export function createOAuthClient() {
  return new google.auth.OAuth2(env.googleClientId, env.googleClientSecret, env.googleRedirectUri);
}

export function createAuthUrl() {
  if (!hasGoogleOAuthConfig()) {
    return null;
  }

  const client = createOAuthClient();

  return client.generateAuthUrl({
    access_type: "offline",
    prompt: "consent",
    scope: [youtubeReadonlyScope]
  });
}
