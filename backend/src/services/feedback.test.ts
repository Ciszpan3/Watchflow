import { describe, expect, it } from "vitest";
import { feedbackReasonFromApi, serializeFeedback } from "./feedback.js";

describe("recommendation feedback contracts", () => {
  it("maps every precise API reason to its persistent representation", () => {
    expect(feedbackReasonFromApi).toEqual({
      already_watched: "ALREADY_WATCHED",
      not_for_me: "NOT_FOR_ME",
      less_topic: "NOT_INTERESTED",
      too_long: "TOO_LONG",
      too_often: "TOO_OFTEN"
    });
  });

  it("keeps legacy not-interested feedback useful and marks it as temporary", () => {
    const updatedAt = new Date("2026-09-01T00:00:00.000Z");
    const serialized = serializeFeedback({
      id: "feedback-1",
      userId: "user-1",
      videoId: "video-1",
      reason: "NOT_INTERESTED",
      targetTopics: [],
      createdAt: updatedAt,
      updatedAt,
      video: {
        id: "video-1",
        channelId: "channel-1",
        title: "A science story",
        description: null,
        thumbnailUrl: null,
        durationSeconds: 600,
        viewCount: null,
        likeCount: null,
        publishedAt: null,
        categoryId: null,
        tags: [],
        language: "en",
        format: "standard",
        topics: ["science"],
        intents: ["learn"],
        audioFriendly: false,
        clickbaitScore: 0,
        liveBroadcastContent: null,
        fetchedAt: updatedAt,
        channel: {
          id: "channel-1",
          title: "Science Channel",
          description: null,
          thumbnailUrl: null,
          subscriberCount: null,
          uploadPlaylistId: null,
          createdAt: updatedAt,
          updatedAt
        }
      }
    });
    expect(serialized).toMatchObject({
      reason: "less_topic",
      targetTopics: ["science"],
      preferenceExpiresAt: "2026-10-01T00:00:00.000Z"
    });
  });
});
