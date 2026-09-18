export const apiBaseUrl = import.meta.env.VITE_API_BASE_URL ?? "http://localhost:4000";

export async function requestSync() {
  const response = await fetch(`${apiBaseUrl}/api/sync/channel`, { method: "POST" });
  if (!response.ok) {
    throw new Error(`Sync failed with status ${response.status}`);
  }
  return response.json() as Promise<{ status: string; message: string }>;
}
