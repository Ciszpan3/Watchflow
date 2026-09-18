import { describe, expect, it } from "vitest";
import { identityScopes, preserveRefreshToken, youtubeReadonlyScope } from "./googleOAuth.js";

describe("Google OAuth contract", () => {
  it("keeps an existing encrypted refresh token when Google omits a new one", () => {
    expect(preserveRefreshToken(undefined, "encrypted-existing")).toBe("encrypted-existing");
    expect(preserveRefreshToken("encrypted-new", "encrypted-existing")).toBe("encrypted-new");
  });

  it("requests identity and read-only YouTube scopes", () => {
    expect(identityScopes).toEqual(["openid", "email", "profile"]);
    expect(youtubeReadonlyScope).toContain("youtube.readonly");
  });
});
