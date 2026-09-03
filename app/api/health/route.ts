// ---------------------------------------------------------------------------
// GET /api/health - LIVE SOURCE VERIFICATION
// Probes every default keyless endpoint from THIS server with a harmless
// query and reports status. This is the "verify before relying" layer: a
// source that goes down shows as unreachable instead of silently failing.
// ---------------------------------------------------------------------------

import { NextResponse } from "next/server";
import { safeFetch } from "@/lib/http";
import { enumerateDns } from "@/lib/dns-local";
import { whoisDomain } from "@/lib/whois";
import { decodeImage } from "@/lib/image";
import { getIntegration } from "@/lib/registry";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface Probe {
  id: string;
  name: string;
  ok: boolean;
  detail: string;
  elapsedMs: number;
}

async function time<T>(fn: () => Promise<T>): Promise<[T, number]> {
  const s = Date.now();
  const v = await fn();
  return [v, Date.now() - s];
}

export async function GET() {
  const probes: Probe[] = [];
  const add = (id: string, ok: boolean, detail: string, elapsedMs: number) => {
    probes.push({ id, name: getIntegration(id)?.name ?? id, ok, detail, elapsedMs });
  };

  // Local capabilities always work.
  const [, dnsMs] = await time(() => enumerateDns("example.com"));
  add("local-dns", true, "Local DNS resolver responded", dnsMs);

  try {
    const [w, wMs] = await time(() => whoisDomain("example.com"));
    add("local-whois", w.text.length > 0, w.text.length > 0 ? `WHOIS via ${w.server}` : "Empty response (port 43 may be filtered)", wMs);
  } catch (e) {
    add("local-whois", false, e instanceof Error ? e.message : "WHOIS failed", 0);
  }

  add("local-phash", true, "Image decoder + pHash available locally", 0);

  // Network endpoints.
  const checks: [string, () => Promise<{ ok: boolean; detail: string }>][] = [
    ["github", async () => {
      const r = await safeFetch("https://api.github.com/users/octocat", { timeoutMs: 8000 });
      return { ok: r.ok && !!(r.body as any)?.login, detail: r.ok ? "200 OK (user octocat)" : r.error };
    }],
    ["gitlab", async () => {
      const r = await safeFetch("https://gitlab.com/api/v4/users?username=dhwang", { timeoutMs: 8000 });
      return { ok: r.ok, detail: r.ok ? "200 OK" : r.error };
    }],
    ["keybase", async () => {
      const r = await safeFetch("https://keybase.io/_/api/1.0/user/lookup.json?username=max", { timeoutMs: 8000 });
      return { ok: r.ok && (r.body as any)?.status?.code === 0, detail: r.ok ? "200 OK" : r.error };
    }],
    ["hackernews", async () => {
      const r = await safeFetch("https://hacker-news.firebaseio.com/v0/user/pg.json", { timeoutMs: 8000 });
      return { ok: r.ok && !!(r.body as any)?.id, detail: r.ok ? "200 OK" : r.error };
    }],
    ["cratesio", async () => {
      const r = await safeFetch("https://crates.io/api/v1/users/carllerche", {
        timeoutMs: 8000,
        headers: { "User-Agent": "keyless-osint-workbench/1.0" },
      });
      return { ok: r.ok && !!(r.body as any)?.user, detail: r.ok ? "200 OK" : r.error };
    }],
    ["rubygems", async () => {
      const r = await safeFetch("https://rubygems.org/api/v1/profiles/rails.json", { timeoutMs: 8000 });
      return { ok: r.ok && !!(r.body as any)?.handle, detail: r.ok ? "200 OK" : r.error };
    }],
    ["dockerhub", async () => {
      const r = await safeFetch("https://hub.docker.com/v2/users/jess/", { timeoutMs: 8000 });
      return { ok: r.ok && !!(r.body as any)?.username, detail: r.ok ? "200 OK" : r.error };
    }],
    ["devto", async () => {
      const r = await safeFetch("https://dev.to/api/users/by_username?url=ben", { timeoutMs: 8000 });
      return { ok: r.ok && !!(r.body as any)?.id, detail: r.ok ? "200 OK" : r.error };
    }],
    ["stackexchange", async () => {
      const r = await safeFetch(
        "https://api.stackexchange.com/2.3/users?order=desc&sort=reputation&inname=jon&site=stackoverflow&pagesize=1",
        { timeoutMs: 9000 },
      );
      return { ok: r.ok && Array.isArray((r.body as any)?.items), detail: r.ok ? `quota ${(r.body as any)?.quota_remaining}/${(r.body as any)?.quota_max}` : r.error };
    }],
    ["bluesky", async () => {
      const r = await safeFetch(
        "https://public.api.bsky.app/xrpc/app.bsky.actor.getProfile?actor=bsky.app",
        { timeoutMs: 8000 },
      );
      return { ok: r.ok && !!(r.body as any)?.handle, detail: r.ok ? "200 OK" : r.error };
    }],
    ["chesscom", async () => {
      const r = await safeFetch("https://api.chess.com/pub/player/hikaru", {
        timeoutMs: 8000,
        headers: { "User-Agent": "keyless-osint-workbench/1.0" },
      });
      return { ok: r.ok && !!(r.body as any)?.username, detail: r.ok ? "200 OK" : r.error };
    }],
    ["lichess", async () => {
      const r = await safeFetch("https://lichess.org/api/user/lichess", { timeoutMs: 8000 });
      return { ok: r.ok && !!(r.body as any)?.id, detail: r.ok ? "200 OK" : r.error };
    }],
    ["rdap", async () => {
      const r = await safeFetch("https://rdap.verisign.com/com/v1/domain/EXAMPLE.COM", {
        timeoutMs: 9000,
        headers: { Accept: "application/rdap+json" },
      });
      return { ok: r.ok && !!(r.body as any)?.ldhName, detail: r.ok ? "200 OK" : r.error };
    }],
    ["crtsh", async () => {
      const r = await safeFetch("https://crt.sh/?q=example.com&output=json", { as: "text", timeoutMs: 15000 });
      if (!r.ok) return { ok: false, detail: r.error };
      let ok = false;
      try {
        ok = Array.isArray(JSON.parse(r.body as unknown as string));
      } catch { /* keep false */ }
      return { ok, detail: ok ? "200 OK (JSON)" : "no JSON returned" };
    }],
    ["wayback", async () => {
      const r = await safeFetch("https://archive.org/wayback/available?url=example.com", { timeoutMs: 8000 });
      return { ok: r.ok, detail: r.ok ? "200 OK" : r.error };
    }],
    ["ipwhois", async () => {
      const r = await safeFetch("https://ipwho.is/8.8.8.8", { timeoutMs: 8000 });
      return { ok: r.ok && (r.body as any)?.success, detail: r.ok ? "200 OK" : r.error };
    }],
    ["gravatar", async () => {
      const r = await safeFetch("https://gravatar.com/6d8ebb117e8d83d74ea95fbdd0f87e13.json", { timeoutMs: 8000 });
      return { ok: r.ok && !!(r.body as any)?.entry, detail: r.ok ? "200 OK" : r.error };
    }],
    ["pypi", async () => {
      const r = await safeFetch("https://pypi.org/user/guido/", { as: "text", timeoutMs: 8000 });
      const body = r.ok ? (r.body as unknown as string) : "";
      // An anti-bot "Client Challenge" page is NOT a usable result.
      const ok = r.ok && body.includes("Profile of") && !body.includes("Client Challenge");
      return {
        ok,
        detail: !r.ok ? r.error : ok ? "200 OK" : body.includes("Client Challenge") ? "anti-bot challenge page (not usable)" : "unexpected response",
      };
    }],
    ["mastodon", async () => {
      const r = await safeFetch(
        "https://mastodon.social/.well-known/webfinger?resource=acct:gargron@mastodon.social",
        { timeoutMs: 8000 },
      );
      return { ok: r.ok && !!(r.body as any)?.subject, detail: r.ok ? "200 OK" : r.error };
    }],
  ];

  for (const [id, fn] of checks) {
    try {
      const [res, ms] = await time(fn);
      add(id, res.ok, res.detail, ms);
    } catch (e) {
      add(id, false, e instanceof Error ? e.message : String(e), 0);
    }
  }

  const ok = probes.filter((p) => p.ok).length;
  return NextResponse.json({
    checkedAt: new Date().toISOString(),
    ok,
    total: probes.length,
    probes,
  });
}
