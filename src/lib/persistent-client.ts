"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import type { Snapshot } from "./server/types";
export async function api<T = Record<string, unknown>>(
  path: string,
  body: unknown = {},
): Promise<T> {
  const response = await fetch(`/api/${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error ?? "Request failed");
  return data;
}
export function usePersistentData() {
  const [data, setData] = useState<Snapshot | null>(null),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  const pending = useRef(0),
    sequence = useRef(0);
  const refresh = useCallback(async () => {
    const seq = ++sequence.current;
    const response = await fetch("/api/snapshot", { cache: "no-store" });
    const next = await response.json();
    if (!response.ok) throw new Error(next.error ?? "Database unavailable");
    if (seq === sequence.current) setData(next as Snapshot);
    return next as Snapshot;
  }, []);
  useEffect(() => {
    void refresh().catch((e) => setError(e.message));
    const onFocus = () => {
      void refresh().catch((e) => setError(e.message));
    };
    const timer = setInterval(onFocus, 5000);
    window.addEventListener("focus", onFocus);
    return () => {
      clearInterval(timer);
      window.removeEventListener("focus", onFocus);
    };
  }, [refresh]);
  const perform = useCallback(
    async <T = Record<string, unknown>>(
      path: string,
      body: unknown = {},
    ): Promise<T> => {
      pending.current++;
      setBusy(true);
      setError("");
      try {
        const result = await api<T>(path, body);
        await refresh();
        return result;
      } catch (e) {
        setError(e instanceof Error ? e.message : "Operation failed");
        await refresh().catch(() => {});
        throw e;
      } finally {
        pending.current--;
        setBusy(pending.current > 0);
      }
    },
    [refresh],
  );
  return { data, error, busy, refresh, perform, setError };
}
