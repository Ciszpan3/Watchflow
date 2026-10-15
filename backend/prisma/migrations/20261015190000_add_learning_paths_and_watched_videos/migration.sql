CREATE TABLE "WatchedVideo" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "videoId" TEXT NOT NULL,
    "watchedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "WatchedVideo_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "LearningPath" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "topic" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "LearningPath_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "LearningPathItem" (
    "id" TEXT NOT NULL,
    "pathId" TEXT NOT NULL,
    "videoId" TEXT NOT NULL,
    "position" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LearningPathItem_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "WatchedVideo_userId_videoId_key" ON "WatchedVideo"("userId", "videoId");
CREATE INDEX "WatchedVideo_userId_watchedAt_idx" ON "WatchedVideo"("userId", "watchedAt");
CREATE INDEX "LearningPath_userId_updatedAt_idx" ON "LearningPath"("userId", "updatedAt");
CREATE UNIQUE INDEX "LearningPathItem_pathId_videoId_key" ON "LearningPathItem"("pathId", "videoId");
CREATE INDEX "LearningPathItem_pathId_position_idx" ON "LearningPathItem"("pathId", "position");

ALTER TABLE "WatchedVideo" ADD CONSTRAINT "WatchedVideo_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "WatchedVideo" ADD CONSTRAINT "WatchedVideo_videoId_fkey" FOREIGN KEY ("videoId") REFERENCES "Video"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "LearningPath" ADD CONSTRAINT "LearningPath_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "LearningPathItem" ADD CONSTRAINT "LearningPathItem_pathId_fkey" FOREIGN KEY ("pathId") REFERENCES "LearningPath"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "LearningPathItem" ADD CONSTRAINT "LearningPathItem_videoId_fkey" FOREIGN KEY ("videoId") REFERENCES "Video"("id") ON DELETE CASCADE ON UPDATE CASCADE;
