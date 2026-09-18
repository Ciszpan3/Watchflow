import request from "supertest";
import { describe, expect, it } from "vitest";
import { app } from "./app.js";

describe("Watchflow API", () => {
  it("reports service health", async () => {
    const response = await request(app).get("/health");
    expect(response.status).toBe(200);
    expect(response.body).toEqual({ status: "ok", service: "watchflow-api" });
  });

  it("returns an anonymous session without exposing credentials", async () => {
    const response = await request(app).get("/api/auth/session");
    expect(response.status).toBe(200);
    expect(response.body).toEqual({ authenticated: false });
    expect(JSON.stringify(response.body)).not.toMatch(/token|secret/i);
  });

  it("protects viewer data without a session", async () => {
    const response = await request(app).get("/api/queue");
    expect(response.status).toBe(401);
    expect(response.body.error).toBe("authentication_required");
  });
});
