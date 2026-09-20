ALTER TABLE "User"
ADD COLUMN "avatarData" BYTEA,
ADD COLUMN "avatarMimeType" TEXT;

CREATE TABLE "ViewerSessionDraft" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "request" JSONB NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "ViewerSessionDraft_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "ViewerSessionDraft_userId_key" ON "ViewerSessionDraft"("userId");

ALTER TABLE "ViewerSessionDraft"
ADD CONSTRAINT "ViewerSessionDraft_userId_fkey"
FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "RecommendationSession"
ADD COLUMN "chainId" TEXT,
ADD COLUMN "page" INTEGER NOT NULL DEFAULT 1;

UPDATE "RecommendationSession" SET "chainId" = "id" WHERE "chainId" IS NULL;

ALTER TABLE "RecommendationSession" ALTER COLUMN "chainId" SET NOT NULL;

CREATE INDEX "RecommendationSession_userId_chainId_page_idx"
ON "RecommendationSession"("userId", "chainId", "page");
