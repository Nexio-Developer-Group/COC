"use client";
import useSWR, { mutate as globalMutate, type SWRConfiguration } from "swr";

export const fetcher = async (url: string) => {
  const res = await fetch(url);
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw Object.assign(new Error(data.error ?? `Request failed (${res.status})`), { status: res.status, data });
  return data;
};

export function useApi<T = any>(url: string | null, config?: SWRConfiguration) { // eslint-disable-line @typescript-eslint/no-explicit-any
  return useSWR<T>(url, fetcher, { revalidateOnFocus: false, keepPreviousData: true, ...config });
}

/** Re-fetch every cached request whose URL contains one of the fragments. */
export function refresh(...fragments: string[]) {
  return globalMutate((key) => typeof key === "string" && fragments.some((f) => key.includes(f)));
}

export async function send<T = any>(url: string, method: string, body?: unknown): Promise<{ ok: boolean; status: number; data: T }> { // eslint-disable-line @typescript-eslint/no-explicit-any
  const res = await fetch(url, { method, headers: body !== undefined ? { "content-type": "application/json" } : undefined, body: body !== undefined ? JSON.stringify(body) : undefined });
  const data = await res.json().catch(() => ({}));
  return { ok: res.ok, status: res.status, data };
}
