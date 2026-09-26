import { randomUUID } from "node:crypto";
import { afterAll, describe, expect, it } from "vitest";
import { env } from "./config/env.js";
import { assertUtf8Database, db } from "./db.js";
import { SyncStatus } from "./generated/prisma/enums.js";
import { recoverOrphanedSyncJobs } from "./services/viewerSync.js";
import { upsertChannels } from "./services/youtubeLive.js";

const databaseTest = describe.runIf(Boolean(env.databaseUrl));

databaseTest("PostgreSQL repositories", () => {
  const suffix = randomUUID();
  let userId = "";
  const channelId = `test-channel-${suffix}`;
  const videoId = `test-video-${suffix}`;

  it("uses UTF8 for international YouTube metadata", async () => {
    await expect(assertUtf8Database()).resolves.toBeUndefined();
  });

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
    await upsertChannels([{ id: channelId, snippet: { title: "Updated test channel" } }]);
    await expect(db.channel.findUniqueOrThrow({ where: { id: channelId } })).resolves.toMatchObject({ title: "Updated test channel" });
    await db.video.create({
      data: { id: videoId, channelId, title: "Test video", durationSeconds: 120, tags: [], format: "short", topics: ["technology"], intents: ["learn"] }
    });
    const draftRequest = {
      minutes: 30, timeLimitEnabled: false, recommendationMode: "single", intent: "relax", source: "mixed",
      topics: [], formats: ["standard"], languages: ["en"], maxAgeMonths: 12, audioFriendly: false, antiClickbait: true
    };
    await db.viewerSessionDraft.create({ data: { userId, request: draftRequest } });
    await expect(db.viewerSessionDraft.findUniqueOrThrow({ where: { userId } })).resolves.toMatchObject({ request: draftRequest });
    const recommendationSession = await db.recommendationSession.create({
      data: { userId, chainId: `chain-${suffix}`, page: 1, request: draftRequest, totalMinutes: 2,
        items: { create: { videoId, position: 0, score: 80, source: "SUBSCRIBED", reason: "Test", signals: ["Test"] } } }
    });
    await expect(db.recommendationSession.findFirst({ where: { id: recommendationSession.id, userId: "another-user" } })).resolves.toBeNull();
    await db.savedVideo.create({ data: { userId, videoId } });
    await expect(db.savedVideo.create({ data: { userId, videoId } })).rejects.toMatchObject({ code: "P2002" });
    await db.syncJob.create({ data: { userId, activeKey: userId } });
    await expect(db.syncJob.create({ data: { userId, activeKey: userId } })).rejects.toMatchObject({ code: "P2002" });
  });

  it("releases an interrupted synchronization job", async () => {
    const recovered = await recoverOrphanedSyncJobs("test_interruption");
    const job = await db.syncJob.findFirstOrThrow({ where: { userId }, orderBy: { startedAt: "desc" } });

    expect(recovered).toBeGreaterThanOrEqual(1);
    expect(job).toMatchObject({
      status: SyncStatus.FAILED,
      activeKey: null,
      phase: "failed",
      errorCode: "test_interruption"
    });
    expect(job.finishedAt).not.toBeNull();
  });
});
