ALTER TABLE "ViewerProfile"
  ADD COLUMN "useWatchHistory" BOOLEAN NOT NULL DEFAULT false;

CREATE TABLE "WatchHistoryItem" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "videoId" TEXT,
  "title" TEXT NOT NULL,
  "channelTitle" TEXT,
  "watchedAt" TIMESTAMP(3) NOT NULL,
  "topics" TEXT[] NOT NULL,
  "importedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "WatchHistoryItem_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "WatchHistoryItem_userId_watchedAt_idx" ON "WatchHistoryItem"("userId", "watchedAt");
CREATE INDEX "WatchHistoryItem_userId_videoId_idx" ON "WatchHistoryItem"("userId", "videoId");

ALTER TABLE "WatchHistoryItem"
  ADD CONSTRAINT "WatchHistoryItem_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
