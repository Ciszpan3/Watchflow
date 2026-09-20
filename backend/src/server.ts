import { app } from "./app.js";
import { env } from "./config/env.js";
import { assertUtf8Database } from "./db.js";
import { recoverOrphanedSyncJobs } from "./services/viewerSync.js";

async function startServer() {
  await assertUtf8Database();
  const recoveredJobs = await recoverOrphanedSyncJobs();
  if (recoveredJobs > 0) {
    console.warn(`Recovered ${recoveredJobs} interrupted YouTube synchronization job(s).`);
  }

  app.listen(env.port, () => {
    console.log(`Watchflow API listening on http://localhost:${env.port}`);
  });
}

void startServer().catch((error) => {
  console.error("Watchflow API failed to start", error);
  process.exitCode = 1;
});
