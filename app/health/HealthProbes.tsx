"use client";

import { useCallback, useEffect, useState } from "react";

interface Probe {
  id: string;
  name: string;
  ok: boolean;
  detail: string;
  elapsedMs: number;
}

export default function HealthProbes() {
  const [probes, setProbes] = useState<Probe[] | null>(null);
  const [checkedAt, setCheckedAt] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const run = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/health", { cache: "no-store" });
      const j = await res.json();
      setProbes(j.probes);
      setCheckedAt(j.checkedAt);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { run(); }, [run]);

  const okCount = probes?.filter((p) => p.ok).length ?? 0;

  return (
    <>
      <div className="card">
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
          <div>
            <strong style={{ fontSize: 16 }}>
              {probes ? <span style={{ color: okCount ? "var(--accent)" : "var(--bad)" }}>{okCount}/{probes.length} sources reachable</span> : "Probing…"}
            </strong>
            {checkedAt && <div className="muted" style={{ fontSize: 12 }}>last checked {new Date(checkedAt).toLocaleString()}</div>}
          </div>
          <button onClick={run} disabled={loading} className="secondary">
            {loading ? <><span className="spinner" /> re-checking…</> : "Re-run verification"}
          </button>
        </div>
        <p className="muted" style={{ fontSize: 12.5, marginBottom: 0 }}>
          Local capabilities (DNS resolver, WHOIS port 43, image hashing) are tested in-process; network
          probes use the same documented public endpoints as the scan engine. “Unreachable” here usually
          means this deployment&apos;s network filters the endpoint — on an open network all keyless sources respond.
        </p>
      </div>

      <div className="result-grid">
        {probes?.map((p) => (
          <div key={p.id} className="source-row">
            <div style={{ flex: 1 }}>
              <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
                <span className="src-name">{p.name}</span>
                <span className={`badge ${p.ok ? "found" : "error"}`}>{p.ok ? "OK" : "UNREACHABLE"}</span>
                <span className="muted" style={{ fontSize: 11 }}>{p.elapsedMs}ms</span>
              </div>
              <div className="src-detail">{p.detail}</div>
            </div>
          </div>
        ))}
      </div>
    </>
  );
}
