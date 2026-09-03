// ---------------------------------------------------------------------------
// HTTP helper: bounded fetches with consistent error handling.
// Every external call goes through here so timeouts, network failures,
// rate limits and unexpected responses are handled uniformly.
// ---------------------------------------------------------------------------

export type FetchOutcome<T = unknown> =
  | { ok: true; status: number; body: T; headers: Headers; url: string }
  | { ok: false; status: number | null; error: string; url: string; rateLimited?: boolean };

export interface FetchOptions {
  method?: "GET" | "HEAD" | "POST";
  headers?: Record<string, string>;
  body?: string;
  timeoutMs?: number;
  /** Parse as JSON (default), text, or arrayBuffer. */
  as?: "json" | "text" | "arrayBuffer";
  /** Retry on network error / 429 (default 1). */
  retries?: number;
}

const DEFAULT_TIMEOUT = 10_000;
const DEFAULT_UA =
  "keyless-osint-workbench/1.0 (+https://github.com/frankb3511-eng/new; research; contact: local)";

export async function safeFetch<T = unknown>(url: string, opts: FetchOptions = {}): Promise<FetchOutcome<T>> {
  const { method = "GET", headers = {}, body, timeoutMs = DEFAULT_TIMEOUT, as = "json", retries = 1 } = opts;
  const hdrs: Record<string, string> = {
    "User-Agent": DEFAULT_UA,
    Accept: as === "json" ? "application/json" : "*/*",
    ...headers,
  };

  let attempt = 0;
  // eslint-disable-next-line no-constant-condition
  while (true) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const res = await fetch(url, {
        method,
        headers: hdrs,
        body,
        signal: controller.signal,
        // Don't leak credentials; don't follow infinite redirects.
        redirect: "follow",
      } as RequestInit);
      clearTimeout(timer);

      if (res.status === 429 || res.status === 503) {
        if (attempt < retries) {
          attempt++;
          await sleep(500 * attempt);
          continue;
        }
        return {
          ok: false,
          status: res.status,
          error: res.status === 429 ? "Rate limited (HTTP 429)" : "Service unavailable (HTTP 503)",
          url,
          rateLimited: res.status === 429,
        };
      }

      if (as === "arrayBuffer") {
        const ab = await res.arrayBuffer();
        return { ok: true, status: res.status, body: ab as unknown as T, headers: res.headers, url };
      }
      const text = await res.text();
      if (as === "text") {
        return { ok: true, status: res.status, body: text as unknown as T, headers: res.headers, url };
      }
      try {
        const json = JSON.parse(text);
        return { ok: true, status: res.status, body: json as T, headers: res.headers, url };
      } catch {
        // Some "JSON" endpoints answer with HTML on error - surface as unexpected.
        return { ok: false, status: res.status, error: `Unexpected non-JSON response (${res.status})`, url };
      }
    } catch (err) {
      clearTimeout(timer);
      const msg = err instanceof Error ? err.message : String(err);
      if (attempt < retries) {
        attempt++;
        await sleep(400 * attempt);
        continue;
      }
      const aborted = msg.includes("abort") || msg.includes("timed out");
      return {
        ok: false,
        status: null,
        error: aborted ? `Timeout after ${timeoutMs}ms` : `Network error: ${msg}`,
        url,
      };
    }
  }
}

export function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

/** Run tasks with bounded concurrency. */
export async function mapPool<T, R>(items: T[], limit: number, fn: (item: T, index: number) => Promise<R>): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let cursor = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (cursor < items.length) {
      const i = cursor++;
      results[i] = await fn(items[i], i);
    }
  });
  await Promise.all(workers);
  return results;
}

/** Tiny in-memory TTL cache (per server process). */
export class TtlCache<V> {
  private store = new Map<string, { value: V; expires: number }>();
  constructor(private ttlMs: number) {}
  get(key: string): V | undefined {
    const hit = this.store.get(key);
    if (!hit) return undefined;
    if (Date.now() > hit.expires) {
      this.store.delete(key);
      return undefined;
    }
    return hit.value;
  }
  set(key: string, value: V): void {
    this.store.set(key, { value, expires: Date.now() + this.ttlMs });
  }
}
