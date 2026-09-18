ALTER TABLE "SyncJob" ADD COLUMN "activeKey" TEXT;

CREATE UNIQUE INDEX "SyncJob_activeKey_key" ON "SyncJob"("activeKey");
