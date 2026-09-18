import React from "react";
import { Check, RefreshCcw } from "lucide-react";
import { getSyncProgress, syncStages, wait } from "../sync";

type Props = {
  onSync: () => Promise<unknown>;
  onComplete: () => void;
  onError: (message: string) => void;
};

export function SyncButton({ onSync, onComplete, onError }: Props) {
  const [stage, setStage] = React.useState(-1);
  const [complete, setComplete] = React.useState(false);
  const syncing = stage >= 0;

  async function handleSync() {
    setComplete(false);
    setStage(0);
    try {
      await onSync();
      for (let next = 1; next < syncStages.length; next += 1) {
        await wait(520);
        setStage(next);
      }
      await wait(520);
      setStage(-1);
      setComplete(true);
      onComplete();
      await wait(1800);
      setComplete(false);
    } catch (error) {
      setStage(-1);
      onError(error instanceof Error ? error.message : "The sync could not be completed.");
    }
  }

  return (
    <div className="sync-control">
      <button className="button primary" type="button" onClick={() => void handleSync()} disabled={syncing}>
        {complete ? <Check aria-hidden="true" /> : <RefreshCcw className={syncing ? "spin" : ""} aria-hidden="true" />}
        {syncing ? "Syncing" : complete ? "Synced" : "Sync now"}
      </button>
      {syncing && (
        <div className="sync-popover" role="status" aria-live="polite">
          <div className="sync-copy">
            <span>{syncStages[stage]}</span>
            <strong>{getSyncProgress(stage)}%</strong>
          </div>
          <div className="progress-track">
            <span style={{ width: `${getSyncProgress(stage)}%` }} />
          </div>
        </div>
      )}
    </div>
  );
}
