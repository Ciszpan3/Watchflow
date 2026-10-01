import type { RecommendationFeedback, Video, Channel } from "../generated/prisma/client.js";

type FeedbackWithVideo = RecommendationFeedback & { video: Video & { channel: Channel } };

export const feedbackReasonFromApi = {
  already_watched: "ALREADY_WATCHED",
  not_for_me: "NOT_FOR_ME",
  less_topic: "NOT_INTERESTED",
  too_long: "TOO_LONG",
  too_often: "TOO_OFTEN"
} as const;

const apiReason = {
  ALREADY_WATCHED: "already_watched",
  NOT_FOR_ME: "not_for_me",
  NOT_INTERESTED: "less_topic",
  TOO_LONG: "too_long",
  TOO_OFTEN: "too_often"
} as const;

export function serializeFeedback(row: FeedbackWithVideo) {
  const preferenceExpiresAt = ["NOT_INTERESTED", "TOO_LONG", "TOO_OFTEN"].includes(row.reason)
    ? new Date(row.updatedAt.getTime() + 30 * 86_400_000).toISOString()
    : null;
  return {
    videoId: row.videoId,
    reason: apiReason[row.reason],
    targetTopics: row.targetTopics.length ? row.targetTopics : row.reason === "NOT_INTERESTED" ? row.video.topics : [],
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    preferenceExpiresAt,
    video: {
      title: row.video.title,
      channel: row.video.channel.title,
      image: row.video.thumbnailUrl ?? "",
      duration: Math.max(1, Math.ceil(row.video.durationSeconds / 60))
    }
  };
}
