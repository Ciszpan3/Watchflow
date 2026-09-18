import React from "react";
import { apiBaseUrl } from "../api";

export function useApiData<T>(path: string) {
  const [data, setData] = React.useState<T | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [loading, setLoading] = React.useState(true);

  React.useEffect(() => {
    const controller = new AbortController();

    async function load() {
      setLoading(true);
      setError(null);
      try {
        const response = await fetch(`${apiBaseUrl}${path}`, { signal: controller.signal });
        if (!response.ok) throw new Error(`Request failed with status ${response.status}`);
        setData((await response.json()) as T);
      } catch (requestError) {
        if (!controller.signal.aborted) {
          setError(requestError instanceof Error ? requestError.message : "Unknown API error");
        }
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    }

    void load();
    return () => controller.abort();
  }, [path]);

  return { data, error, loading };
}
