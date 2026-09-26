import { CheckCircle2, ExternalLink, History, LoaderCircle, Trash2, Upload, X } from "lucide-react";
import * as React from "react";
import type { WatchHistoryImportItem, WatchHistorySummary } from "../viewerTypes";

function videoIdFromUrl(value: unknown) {
  if (typeof value !== "string") return null;
  try {
    const url = new URL(value);
    const id = url.searchParams.get("v") ?? url.pathname.match(/\/(?:shorts|embed|live)\/([A-Za-z0-9_-]{6,32})/)?.[1];
    return id && /^[A-Za-z0-9_-]{6,32}$/.test(id) ? id : null;
  } catch {
    return null;
  }
}

export function parseTakeoutHistory(value: unknown): WatchHistoryImportItem[] {
  if (!Array.isArray(value)) return [];
  return value.map((entry) => {
    if (!entry || typeof entry !== "object") return null;
    const item = entry as { title?: unknown; titleUrl?: unknown; time?: unknown; subtitles?: Array<{ name?: unknown }> };
    const title = typeof item.title === "string" ? item.title.replace(/^Watched\s+/i, "").trim() : "";
    const watchedAt = typeof item.time === "string" ? new Date(item.time) : null;
    if (!title || !watchedAt || Number.isNaN(watchedAt.getTime())) return null;
    return {
      videoId: videoIdFromUrl(item.titleUrl),
      title: title.slice(0, 300),
      channelTitle: typeof item.subtitles?.[0]?.name === "string" ? item.subtitles[0].name.slice(0, 200) : null,
      watchedAt: watchedAt.toISOString()
    } satisfies WatchHistoryImportItem;
  }).filter((item): item is WatchHistoryImportItem => Boolean(item))
    .sort((left, right) => right.watchedAt.localeCompare(left.watchedAt))
    .slice(0, 5000);
}

export function WatchHistoryModal({ open, mode, summary, onClose, onImport, onClear }: {
  open: boolean;
  mode: "demo" | "live";
  summary: WatchHistorySummary;
  onClose: () => void;
  onImport: (items: WatchHistoryImportItem[]) => Promise<void>;
  onClear: () => Promise<void>;
}) {
  const [parsed, setParsed] = React.useState<WatchHistoryImportItem[]>([]);
  const [error, setError] = React.useState("");
  const [busy, setBusy] = React.useState(false);

  React.useEffect(() => {
    if (open) {
      setParsed([]);
      setError("");
      setBusy(false);
    }
  }, [open]);

  if (!open) return null;

  async function chooseFile(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) return;
    setError("");
    try {
      const value: unknown = JSON.parse(await file.text());
      const items = parseTakeoutHistory(value);
      if (!items.length) throw new Error("No YouTube watch entries were found in this file.");
      setParsed(items);
    } catch (cause) {
      setParsed([]);
      setError(cause instanceof Error ? cause.message : "This file could not be read.");
    } finally {
      event.target.value = "";
    }
  }

  async function importSelected() {
    setBusy(true);
    setError("");
    try {
      await onImport(parsed);
      onClose();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Watch history could not be imported.");
      setBusy(false);
    }
  }

  async function clear() {
    setBusy(true);
    setError("");
    try {
      await onClear();
      onClose();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Watch history could not be removed.");
      setBusy(false);
    }
  }

  return <div className="onboarding-backdrop" role="presentation">
    <div className="onboarding-modal history-modal" role="dialog" aria-modal="true" aria-labelledby="history-title">
      <header className="onboarding-header"><div className="onboarding-brand"><span><History /></span><div><strong>Import watch history</strong><small>Optional signal, controlled by you</small></div></div><button className="icon-button" type="button" onClick={onClose} aria-label="Close watch history dialog"><X /></button></header>
      <div className="onboarding-content">
        <span className="section-kicker">Google Takeout</span>
        <h2 id="history-title">Bring your real viewing habits into Watchflow</h2>
        <p>Watchflow cannot read your YouTube history directly. You can export it from Google Takeout, choose the JSON watch-history file here, and decide whether it should influence recommendations.</p>
        <ol className="history-steps"><li>Open Google Takeout and select only YouTube history.</li><li>Create an export and download the ZIP file.</li><li>Unzip it and select <strong>watch-history.json</strong> below.</li></ol>
        <a className="button secondary" href="https://takeout.google.com/" target="_blank" rel="noreferrer"><ExternalLink />Open Google Takeout</a>
        <label className="history-upload"><Upload /><span><strong>Choose watch-history.json</strong><small>Up to 5,000 most recent entries are imported. The file is parsed in your browser.</small></span><input type="file" accept=".json,application/json" onChange={(event) => void chooseFile(event)} /></label>
        {parsed.length > 0 && <div className="history-ready"><CheckCircle2 /><span><strong>{parsed.length.toLocaleString()} entries ready</strong><small>Titles and timestamps will be used to infer interests. Raw file data is never uploaded.</small></span></div>}
        {summary.count > 0 && <div className="history-current"><History /><span><strong>{summary.count.toLocaleString()} entries currently imported</strong><small>Importing a new file replaces the previous import.</small></span><button className="icon-button quiet" type="button" onClick={() => void clear()} disabled={busy} aria-label="Remove imported watch history">{busy ? <LoaderCircle className="spin" /> : <Trash2 />}</button></div>}
        {error && <p className="onboarding-error" role="alert">{error}</p>}
      </div>
      <footer className="onboarding-footer"><button className="button text-button" type="button" onClick={onClose}>Cancel</button><button className="button primary" type="button" onClick={() => void importSelected()} disabled={!parsed.length || busy}>{busy ? <LoaderCircle className="spin" /> : <CheckCircle2 />}{busy ? "Importing…" : `Import ${parsed.length ? parsed.length.toLocaleString() : "history"}`}</button></footer>
    </div>
  </div>;
}
