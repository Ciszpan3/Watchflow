ALTER TABLE "ViewerProfile"
  DROP COLUMN "novelty",
  DROP COLUMN "depth",
  DROP COLUMN "pace",
  ALTER COLUMN "version" SET DEFAULT 2;

UPDATE "ViewerProfile" SET "version" = 2;
