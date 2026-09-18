-- CreateEnum
CREATE TYPE "ProfileStatus" AS ENUM ('NOT_STARTED', 'IN_PROGRESS', 'COMPLETED', 'SKIPPED');

-- CreateEnum
CREATE TYPE "VideoSource" AS ENUM ('SUBSCRIBED', 'NEW');

-- CreateEnum
CREATE TYPE "SyncStatus" AS ENUM ('QUEUED', 'RUNNING', 'SUCCEEDED', 'FAILED');

-- CreateEnum
CREATE TYPE "FeedbackReason" AS ENUM ('ALREADY_WATCHED', 'NOT_INTERESTED', 'TOO_LONG', 'TOO_OFTEN');

-- CreateEnum
CREATE TYPE "ActivityType" AS ENUM ('OPENED', 'SAVED', 'UNSAVED');

-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "googleSubject" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "displayName" TEXT NOT NULL,
    "avatarUrl" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "GoogleAccount" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "encryptedRefreshToken" TEXT,
    "scopes" TEXT[],
    "needsReconnect" BOOLEAN NOT NULL DEFAULT false,
    "syncCursor" INTEGER NOT NULL DEFAULT 0,
    "lastSyncedAt" TIMESTAMP(3),
    "connectedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "GoogleAccount_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AuthSession" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AuthSession_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ViewerProfile" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "status" "ProfileStatus" NOT NULL DEFAULT 'NOT_STARTED',
    "interests" TEXT[],
    "customTopics" TEXT[],
    "excludedTopics" TEXT[],
    "languages" TEXT[],
    "formats" TEXT[],
    "defaultSource" TEXT NOT NULL DEFAULT 'mixed',
    "novelty" INTEGER NOT NULL DEFAULT 58,
    "depth" INTEGER NOT NULL DEFAULT 62,
    "pace" INTEGER NOT NULL DEFAULT 48,
    "audioFriendly" BOOLEAN NOT NULL DEFAULT false,
    "antiClickbait" BOOLEAN NOT NULL DEFAULT true,
    "useSubscriptions" BOOLEAN NOT NULL DEFAULT true,
    "useLikedVideos" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ViewerProfile_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Channel" (
    "id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "thumbnailUrl" TEXT,
    "uploadPlaylistId" TEXT,
    "subscriberCount" BIGINT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Channel_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Video" (
    "id" TEXT NOT NULL,
    "channelId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "thumbnailUrl" TEXT,
    "durationSeconds" INTEGER NOT NULL,
    "publishedAt" TIMESTAMP(3),
    "viewCount" BIGINT,
    "likeCount" BIGINT,
    "tags" TEXT[],
    "categoryId" TEXT,
    "language" TEXT,
    "format" TEXT NOT NULL,
    "topics" TEXT[],
    "intents" TEXT[],
    "audioFriendly" BOOLEAN NOT NULL DEFAULT false,
    "clickbaitScore" INTEGER NOT NULL DEFAULT 0,
    "liveBroadcastContent" TEXT,
    "fetchedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Video_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Subscription" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "channelId" TEXT NOT NULL,
    "importedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastCheckedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Subscription_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LikedVideo" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "videoId" TEXT NOT NULL,
    "importedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LikedVideo_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "UserVideoCandidate" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "videoId" TEXT NOT NULL,
    "source" "VideoSource" NOT NULL,
    "discoveredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "UserVideoCandidate_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SyncJob" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "status" "SyncStatus" NOT NULL DEFAULT 'QUEUED',
    "phase" TEXT NOT NULL DEFAULT 'queued',
    "subscriptionsCount" INTEGER NOT NULL DEFAULT 0,
    "likedVideosCount" INTEGER NOT NULL DEFAULT 0,
    "candidatesCount" INTEGER NOT NULL DEFAULT 0,
    "errorCode" TEXT,
    "errorMessage" TEXT,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finishedAt" TIMESTAMP(3),

    CONSTRAINT "SyncJob_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RecommendationSession" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "request" JSONB NOT NULL,
    "totalMinutes" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RecommendationSession_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RecommendationItem" (
    "id" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,
    "videoId" TEXT NOT NULL,
    "position" INTEGER NOT NULL,
    "score" INTEGER NOT NULL,
    "source" "VideoSource" NOT NULL,
    "reason" TEXT NOT NULL,
    "signals" TEXT[],

    CONSTRAINT "RecommendationItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SavedVideo" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "videoId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SavedVideo_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RecommendationFeedback" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "videoId" TEXT NOT NULL,
    "reason" "FeedbackReason" NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RecommendationFeedback_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ViewingActivity" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "videoId" TEXT NOT NULL,
    "type" "ActivityType" NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ViewingActivity_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SearchCache" (
    "id" TEXT NOT NULL,
    "cacheKey" TEXT NOT NULL,
    "query" TEXT NOT NULL,
    "language" TEXT NOT NULL,
    "format" TEXT,
    "videoIds" TEXT[],
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SearchCache_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ApiQuotaUsage" (
    "id" TEXT NOT NULL,
    "dayKey" TEXT NOT NULL,
    "method" TEXT NOT NULL,
    "calls" INTEGER NOT NULL DEFAULT 0,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ApiQuotaUsage_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "User_googleSubject_key" ON "User"("googleSubject");

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE UNIQUE INDEX "GoogleAccount_userId_key" ON "GoogleAccount"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "AuthSession_tokenHash_key" ON "AuthSession"("tokenHash");

-- CreateIndex
CREATE INDEX "AuthSession_userId_idx" ON "AuthSession"("userId");

-- CreateIndex
CREATE INDEX "AuthSession_expiresAt_idx" ON "AuthSession"("expiresAt");

-- CreateIndex
CREATE UNIQUE INDEX "ViewerProfile_userId_key" ON "ViewerProfile"("userId");

-- CreateIndex
CREATE INDEX "Video_channelId_publishedAt_idx" ON "Video"("channelId", "publishedAt");

-- CreateIndex
CREATE INDEX "Subscription_userId_idx" ON "Subscription"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "Subscription_userId_channelId_key" ON "Subscription"("userId", "channelId");

-- CreateIndex
CREATE INDEX "LikedVideo_userId_idx" ON "LikedVideo"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "LikedVideo_userId_videoId_key" ON "LikedVideo"("userId", "videoId");

-- CreateIndex
CREATE INDEX "UserVideoCandidate_userId_source_expiresAt_idx" ON "UserVideoCandidate"("userId", "source", "expiresAt");

-- CreateIndex
CREATE UNIQUE INDEX "UserVideoCandidate_userId_videoId_source_key" ON "UserVideoCandidate"("userId", "videoId", "source");

-- CreateIndex
CREATE INDEX "SyncJob_userId_startedAt_idx" ON "SyncJob"("userId", "startedAt");

-- CreateIndex
CREATE INDEX "RecommendationSession_userId_createdAt_idx" ON "RecommendationSession"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "RecommendationItem_sessionId_position_idx" ON "RecommendationItem"("sessionId", "position");

-- CreateIndex
CREATE UNIQUE INDEX "RecommendationItem_sessionId_videoId_key" ON "RecommendationItem"("sessionId", "videoId");

-- CreateIndex
CREATE INDEX "SavedVideo_userId_createdAt_idx" ON "SavedVideo"("userId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "SavedVideo_userId_videoId_key" ON "SavedVideo"("userId", "videoId");

-- CreateIndex
CREATE INDEX "RecommendationFeedback_userId_reason_idx" ON "RecommendationFeedback"("userId", "reason");

-- CreateIndex
CREATE UNIQUE INDEX "RecommendationFeedback_userId_videoId_key" ON "RecommendationFeedback"("userId", "videoId");

-- CreateIndex
CREATE INDEX "ViewingActivity_userId_createdAt_idx" ON "ViewingActivity"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "ViewingActivity_userId_videoId_idx" ON "ViewingActivity"("userId", "videoId");

-- CreateIndex
CREATE UNIQUE INDEX "SearchCache_cacheKey_key" ON "SearchCache"("cacheKey");

-- CreateIndex
CREATE INDEX "SearchCache_expiresAt_idx" ON "SearchCache"("expiresAt");

-- CreateIndex
CREATE UNIQUE INDEX "ApiQuotaUsage_dayKey_method_key" ON "ApiQuotaUsage"("dayKey", "method");

-- AddForeignKey
ALTER TABLE "GoogleAccount" ADD CONSTRAINT "GoogleAccount_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuthSession" ADD CONSTRAINT "AuthSession_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ViewerProfile" ADD CONSTRAINT "ViewerProfile_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Video" ADD CONSTRAINT "Video_channelId_fkey" FOREIGN KEY ("channelId") REFERENCES "Channel"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Subscription" ADD CONSTRAINT "Subscription_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Subscription" ADD CONSTRAINT "Subscription_channelId_fkey" FOREIGN KEY ("channelId") REFERENCES "Channel"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LikedVideo" ADD CONSTRAINT "LikedVideo_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LikedVideo" ADD CONSTRAINT "LikedVideo_videoId_fkey" FOREIGN KEY ("videoId") REFERENCES "Video"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserVideoCandidate" ADD CONSTRAINT "UserVideoCandidate_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserVideoCandidate" ADD CONSTRAINT "UserVideoCandidate_videoId_fkey" FOREIGN KEY ("videoId") REFERENCES "Video"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SyncJob" ADD CONSTRAINT "SyncJob_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RecommendationSession" ADD CONSTRAINT "RecommendationSession_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RecommendationItem" ADD CONSTRAINT "RecommendationItem_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "RecommendationSession"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RecommendationItem" ADD CONSTRAINT "RecommendationItem_videoId_fkey" FOREIGN KEY ("videoId") REFERENCES "Video"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SavedVideo" ADD CONSTRAINT "SavedVideo_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SavedVideo" ADD CONSTRAINT "SavedVideo_videoId_fkey" FOREIGN KEY ("videoId") REFERENCES "Video"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RecommendationFeedback" ADD CONSTRAINT "RecommendationFeedback_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RecommendationFeedback" ADD CONSTRAINT "RecommendationFeedback_videoId_fkey" FOREIGN KEY ("videoId") REFERENCES "Video"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ViewingActivity" ADD CONSTRAINT "ViewingActivity_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ViewingActivity" ADD CONSTRAINT "ViewingActivity_videoId_fkey" FOREIGN KEY ("videoId") REFERENCES "Video"("id") ON DELETE CASCADE ON UPDATE CASCADE;
