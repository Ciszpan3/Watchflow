import { beforeEach, describe, expect, it } from "vitest";
import { env } from "../config/env.js";
import { decryptSecret, encryptSecret, hashToken, randomToken, tokensEqual } from "./security.js";

describe("token security", () => {
  beforeEach(() => {
    env.tokenEncryptionKey = Buffer.alloc(32, 7).toString("base64");
  });

  it("encrypts refresh tokens with authenticated encryption", () => {
    const encrypted = encryptSecret("refresh-token-value");
    expect(encrypted).not.toContain("refresh-token-value");
    expect(decryptSecret(encrypted)).toBe("refresh-token-value");
  });

  it("rejects ciphertext modified after encryption", () => {
    const encrypted = encryptSecret("refresh-token-value");
    const replacement = encrypted.endsWith("A") ? "B" : "A";
    expect(() => decryptSecret(`${encrypted.slice(0, -1)}${replacement}`)).toThrow();
  });

  it("creates opaque session tokens and compares state safely", () => {
    const token = randomToken();
    expect(token).toHaveLength(43);
    expect(hashToken(token)).toMatch(/^[a-f0-9]{64}$/);
    expect(tokensEqual(token, token)).toBe(true);
    expect(tokensEqual(token, `${token}x`)).toBe(false);
  });
});
