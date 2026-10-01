ALTER TYPE "FeedbackReason" ADD VALUE IF NOT EXISTS 'NOT_FOR_ME';

ALTER TABLE "RecommendationFeedback"
ADD COLUMN "targetTopics" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];

UPDATE "RecommendationFeedback" AS feedback
SET "targetTopics" = video."topics"
FROM "Video" AS video
WHERE feedback."videoId" = video."id"
  AND feedback."reason" = 'NOT_INTERESTED'
  AND cardinality(feedback."targetTopics") = 0;
