export function formatNumber(value: number) {
  return new Intl.NumberFormat("en", { notation: value >= 100000 ? "compact" : "standard" }).format(value);
}

export function formatPercent(value: number) {
  return `${(value * 100).toFixed(1)}%`;
}

export function formatTrend(value: number) {
  const sign = value > 0 ? "+" : "";
  return `${sign}${value.toFixed(1)}%`;
}

export function formatDate(value: string) {
  return new Intl.DateTimeFormat("en", { month: "short", day: "numeric", year: "numeric" }).format(new Date(value));
}

export function formatRelativeTime(value: string) {
  const minutes = Math.max(0, Math.round((Date.now() - Date.parse(value)) / 60000));
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m ago`;
  return `${Math.round(minutes / 60)}h ago`;
}
