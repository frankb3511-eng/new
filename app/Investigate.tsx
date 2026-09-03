"use client";

import { useState } from "react";
import type { EngineResult, CheckResult, Correlation } from "@/lib/types";

const TYPE_LABEL: Record<string, string> = {
  auto: "Auto-detect",
  username: "Username",
  domain: "Domain",
  email: "Email",
  ip: "IP address",
};

const EXAMPLES: Record<string, string> = {
  username: "torvalds",
  domain: "example.com",
  email: "jondoe@example.com",
  ip: "8.8.8.8",
};

function badgeFor(c: CheckResult) {
  switch (c.status) {
    case "found":
      return <span className="badge found">FOUND</span>;
    case "not-found":
      return <span className="badge notfound">no account</span>;
    case "rate-limited":
      return <span className="badge rate">rate limited</span>;
    case "unsupported":
      return <span className="badge notfound">unsupported</span>;
    default:
      return <span className="badge error">error</span>;
  }
}

export default function Investigate() {
  const [type, setType] = useState("auto");
  const [target, setTarget] = useState("");
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<EngineResult | null>(null);
  const [detected, setDetected] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<"all" | "found" | "issues">("all");

  async function run(e?: React.FormEvent) {
    e?.preventDefault();
    if (!target.trim()) return;
    setLoading(true);
    setError(null);
    setResult(null);
    try {
      const res = await fetch("/api/investigate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ type, target: target.trim() }),
      });
      const json = await res.json();
      if (!res.ok) {
        setError(json.error ?? "Request failed");
      } else {
        setResult(json.result);
        setDetected(json.detected);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }

  const foundCount = result?.checks.filter((c) => c.status === "found").length ?? 0;
  const errCount = result?.checks.filter((c) => c.status === "error" || c.status === "rate-limited").length ?? 0;
  const checks = (result?.checks ?? []).filter((c) => {
    if (filter === "found") return c.status === "found";
    if (filter === "issues") return c.status === "error" || c.status === "rate-limited";
    return true;
  });

  return (
    <>
      <form className="card scan-form" onSubmit={run}>
        <select value={type} onChange={(e) => setType(e.target.value)} aria-label="Target type">
          {Object.entries(TYPE_LABEL).map(([k, v]) => (
            <option key={k} value={k}>{v}</option>
          ))}
        </select>
        <input
          value={target}
          onChange={(e) => setTarget(e.target.value)}
          placeholder="username, domain, email, or IP…"
          aria-label="Investigation target"
          spellCheck={false}
        />
        <button type="submit" disabled={loading || !target.trim()}>
          {loading ? <><span className="spinner" /> Scanning…</> : "Investigate"}
        </button>
      </form>
      <div className="pill-group">
        {Object.entries(EXAMPLES).map(([k, v]) => (
          <button
            key={k}
            type="button"
            className="secondary"
            style={{ padding: "4px 12px", fontSize: 12 }}
            onClick={() => { setType(k); setTarget(v); }}
          >
            try {k}: {v}
          </button>
        ))}
      </div>

      {error && <div className="warn-box" style={{ borderColor: "rgba(248,113,113,0.4)" }}>⚠ {error}</div>}

      {result && (
        <>
          <div className="summary-bar">
            <div className="stat"><div className="num" style={{ color: "var(--accent)" }}>{foundCount}</div><div className="lbl">sources hit</div></div>
            <div className="stat"><div className="num">{result.checks.length}</div><div className="lbl">sources checked</div></div>
            <div className="stat"><div className="num" style={{ color: errCount ? "var(--warn)" : undefined }}>{errCount}</div><div className="lbl">errors / rate limits</div></div>
            <div className="stat"><div className="num">{(result.elapsedMs / 1000).toFixed(1)}s</div><div className="lbl">elapsed</div></div>
            <div className="stat"><div className="num" style={{ textTransform: "capitalize" }}>{detected}</div><div className="lbl">detected type</div></div>
          </div>

          {result.correlations && result.correlations.length > 0 && (
            <section>
              <div className="section-head"><h2>🔗 Correlations</h2></div>
              {result.correlations.map((c: Correlation) => (
                <div key={c.id} className="correlation">
                  <strong>{Math.round(c.strength * 100)}% match</strong> — {c.detail}
                  <div className="members">
                    {c.members.map((m, i) => (
                      <span key={i}>
                        {m.url ? <a href={m.url} target="_blank" rel="noreferrer">{m.sourceName}{m.detail ? ` (${m.detail})` : ""}</a> : `${m.sourceName}${m.detail ? ` (${m.detail})` : ""}`}
                        {i < c.members.length - 1 ? " · " : ""}
                      </span>
                    ))}
                  </div>
                </div>
              ))}
            </section>
          )}

          {result.findings.filter((f) => f.type !== "profile" && f.type !== "correlation").length > 0 && (
            <section>
              <div className="section-head"><h2>Findings</h2></div>
              {result.findings
                .filter((f) => f.type !== "profile" && f.type !== "correlation")
                .map((f, i) => (
                  <div key={i} className="source-row">
                    <div>
                      <div className="src-name">{f.sourceName}</div>
                      <div className="src-detail">{f.value}</div>
                      {f.url && <div className="src-url"><a href={f.url} target="_blank" rel="noreferrer">{f.url}</a></div>}
                      {f.type === "subdomains" && Array.isArray(f.data?.subdomains) && (
                        <details>
                          <summary>{(f.data?.subdomains as string[]).length} subdomains</summary>
                          <pre>{(f.data?.subdomains as string[]).join("\n")}</pre>
                        </details>
                      )}
                    </div>
                  </div>
                ))}
            </section>
          )}

          <section>
            <div className="section-head">
              <h2>Sources ({checks.length})</h2>
              <div className="pill-group" style={{ margin: 0 }}>
                {(["all", "found", "issues"] as const).map((f) => (
                  <button key={f} className="secondary" style={{ padding: "3px 10px", fontSize: 12 }} onClick={() => setFilter(f)}>
                    {f === "all" ? "All" : f === "found" ? "Hits only" : "Issues"}
                  </button>
                ))}
              </div>
            </div>
            <div className="result-grid">
              {checks.map((c) => (
                <div key={c.sourceId} className="source-row">
                  {c.profile?.avatarUrl ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img className="avatar" src={c.profile.avatarUrl} alt="" referrerPolicy="no-referrer" onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }} />
                  ) : (
                    <div className="avatar-placeholder">?</div>
                  )}
                  <div style={{ flex: 1 }}>
                    <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
                      <span className="src-name">{c.sourceName}</span>
                      {badgeFor(c)}
                      {c.elapsedMs != null && <span className="muted" style={{ fontSize: 11 }}>{c.elapsedMs}ms</span>}
                    </div>
                    <div className="src-detail">
                      {c.message ?? c.error ?? (c.status === "not-found" ? "No profile found" : "")}
                    </div>
                    {c.profile?.displayName && (
                      <div className="src-detail">
                        {c.profile.displayName}
                        {c.profile.location ? ` · ${c.profile.location}` : ""}
                        {c.profile.followers != null ? ` · ${c.profile.followers.toLocaleString()} followers` : ""}
                        {c.profile.joinedAt ? ` · joined ${c.profile.joinedAt.slice(0, 10)}` : ""}
                      </div>
                    )}
                    {c.profile?.bio && <div className="src-detail" style={{ fontStyle: "italic" }}>“{c.profile.bio.slice(0, 200)}”</div>}
                    {c.url && <div className="src-url"><a href={c.url} target="_blank" rel="noreferrer">{c.url}</a></div>}
                  </div>
                </div>
              ))}
            </div>
          </section>

          {result.errors.length > 0 && (
            <section>
              <h2>Notes</h2>
              <div className="card">
                {result.errors.map((e, i) => (
                  <div key={i} className="muted" style={{ marginBottom: 4 }}>• {e}</div>
                ))}
                <p className="muted" style={{ marginTop: 10, fontSize: 12 }}>
                  Network errors are expected on restricted networks — each source is independent and the
                  scan degrades gracefully. Check the <a href="/health">Health</a> page to see which
                  endpoints are reachable from this server.
                </p>
              </div>
            </section>
          )}
        </>
      )}
    </>
  );
}
