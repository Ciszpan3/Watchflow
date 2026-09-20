import { describe, expect, it } from "vitest";
import { isTrustedAvatarUrl } from "./avatar.js";

describe("Google avatar proxy", () => {
  it("accepts only HTTPS images from trusted Google hosts", () => {
    expect(isTrustedAvatarUrl("https://lh3.googleusercontent.com/a/example")).toBe(true);
    expect(isTrustedAvatarUrl("https://example.ggpht.com/avatar.png")).toBe(true);
    expect(isTrustedAvatarUrl("http://lh3.googleusercontent.com/a/example")).toBe(false);
    expect(isTrustedAvatarUrl("https://googleusercontent.com.evil.example/avatar.png")).toBe(false);
    expect(isTrustedAvatarUrl("not-a-url")).toBe(false);
  });
});
