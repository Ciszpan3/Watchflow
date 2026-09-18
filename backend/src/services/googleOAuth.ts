import { google } from "googleapis";
import { env, hasGoogleOAuthConfig } from "../config/env.js";

export const youtubeReadonlyScope = "https://www.googleapis.com/auth/youtube.readonly";
export const identityScopes = ["openid", "email", "profile"];

export function preserveRefreshToken(nextToken: string | null | undefined, encryptedExisting: string | null | undefined) {
  return nextToken || encryptedExisting || null;
}

export function createOAuthClient() {
  return new google.auth.OAuth2(env.googleClientId, env.googleClientSecret, env.googleRedirectUri);
}

export function createAuthUrl(state: string) {
  if (!hasGoogleOAuthConfig()) {
    return null;
  }

  const client = createOAuthClient();

  return client.generateAuthUrl({
    access_type: "offline",
    prompt: "consent",
    include_granted_scopes: true,
    state,
    scope: [...identityScopes, youtubeReadonlyScope]
  });
}
