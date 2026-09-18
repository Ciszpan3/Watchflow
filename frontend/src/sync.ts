export const syncStages = ["Connecting", "Reading channel", "Refreshing videos", "Building insights"] as const;

export function getSyncProgress(stage: number) {
  return Math.round(((stage + 1) / syncStages.length) * 100);
}

export function wait(milliseconds: number) {
  return new Promise<void>((resolve) => window.setTimeout(resolve, milliseconds));
}
