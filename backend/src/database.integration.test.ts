import { randomUUID } from "node:crypto";
import { afterAll, describe, expect, it } from "vitest";
import { env } from "./config/env.js";
import { db } from "./db.js";

const databaseTest = describe.runIf(Boolean(env.databaseUrl));

databaseTest("PostgreSQL repositories", () => {
  const suffix = randomUUID();
  let userId = "";
  const channelId = `test-channel-${suffix}`;
  const videoId = `test-video-${suffix}`;

  afterAll(async () => {
    if (userId) await db.user.deleteMany({ where: { id: userId } });
    await db.video.deleteMany({ where: { id: videoId } });
    await db.channel.deleteMany({ where: { id: channelId } });
    await db.$disconnect();
  });

  it("enforces account, saved-video and active-sync uniqueness", async () => {
    const user = await db.user.create({
      data: {
        googleSubject: `subject-${suffix}`,
        email: `${suffix}@example.test`,
        displayName: "Database test",
        profile: { create: { interests: [], customTopics: [], excludedTopics: [], languages: ["en"], formats: ["standard"] } }
      }
    });
    userId = user.id;
    await db.channel.create({ data: { id: channelId, title: "Test channel" } });
    await db.video.create({
      data: { id: videoId, channelId, title: "Test video", durationSeconds: 120, tags: [], format: "short", topics: ["technology"], intents: ["learn"] }
    });
    await db.savedVideo.create({ data: { userId, videoId } });
    await expect(db.savedVideo.create({ data: { userId, videoId } })).rejects.toMatchObject({ code: "P2002" });
    await db.syncJob.create({ data: { userId, activeKey: userId } });
    await expect(db.syncJob.create({ data: { userId, activeKey: userId } })).rejects.toMatchObject({ code: "P2002" });
  });
});
