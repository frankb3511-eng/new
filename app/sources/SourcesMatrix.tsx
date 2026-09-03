"use client";

import { useEffect, useState } from "react";
import type { Integration } from "@/lib/types";

type Row = Integration & { statusLabel: string };

const TIER_BADGE: Record<string, string> = { tier1: "tier1", tier2: "tier2", tier3: "tier3" };
const TIER_TEXT: Record<string, string> = {
  tier1: "Tier 1 — keyless, default",
  tier2: "Tier 2 — optional key",
  tier3: "Tier 3 — paid/restricted",
};

export default function SourcesMatrix() {
  const [rows, setRows] = useState<Row[]>([]);
  const [tier, setTier] = useState<"all" | "tier1" | "tier2" | "tier3">("tier1");

  useEffect(() => {
    fetch("/api/sources")
      .then((r) => r.json())
      .then((j) => setRows(j.sources));
  }, []);

  const filtered = rows.filter((r) => tier === "all" || r.tier === tier);

  return (
    <>
      <div className="card">
        <h2 style={{ marginTop: 0 }}>Optional integrations</h2>
        <p className="muted" style={{ margin: "4px 0 12px" }}>
          The app never requires a key to run. Tier 2/3 sources are documented here for transparency; they
          are not part of the default scan.
        </p>
        <div className="pill-group">
          <span className="tier ok">✓ Keyless sources</span>
          <span className="tier opt">○ Optional API key</span>
          <span className="tier opt">○ Account required</span>
          <span className="tier paid">○ Paid</span>
        </div>
      </div>

      <div className="pill-group" style={{ margin: "10px 0 16px" }}>
        {(["tier1", "tier2", "tier3", "all"] as const).map((t) => (
          <button key={t} className="secondary" onClick={() => setTier(t)}
            style={{ padding: "6px 14px", fontSize: 13, borderColor: tier === t ? "var(--accent-dim)" : undefined }}>
            {t === "all" ? "Show all" : TIER_TEXT[t]}
          </button>
        ))}
      </div>

      <div className="card" style={{ padding: 6, overflowX: "auto" }}>
        <table>
          <thead>
            <tr>
              <th>Source</th>
              <th>Capability</th>
              <th>Keyless</th>
              <th>Free</th>
              <th>Account</th>
              <th>Automation</th>
              <th>Rate limit</th>
              <th>Status</th>
              <th>Docs</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((r) => (
              <tr key={r.id}>
                <td>
                  <strong>{r.name}</strong>
                  <div className="muted" style={{ fontSize: 11.5 }}>{r.id} · {r.implementation}</div>
                </td>
                <td style={{ fontSize: 12.5 }}>
                  <div>{r.input} → {r.category}</div>
                  <div className="muted" style={{ fontSize: 11.5 }}>{r.limitations}</div>
                </td>
                <td>{r.keyRequired ? "—" : "✓"}</td>
                <td>{r.paid ? <span style={{ color: "var(--bad)" }}>PAID</span> : "✓"}</td>
                <td>{r.accountRequired ? "required" : "none"}</td>
                <td style={{ fontSize: 12 }}>{r.automation}</td>
                <td style={{ fontSize: 12 }} className="muted">{r.rateLimit}</td>
                <td>
                  <span className={`badge ${TIER_BADGE[r.tier]}`} style={{ marginBottom: 4 }}>{r.status}</span>
                  {r.lastVerified && <div className="muted" style={{ fontSize: 11 }}>verified {r.lastVerified}</div>}
                </td>
                <td style={{ fontSize: 12 }}>
                  <a href={r.officialDocumentation} target="_blank" rel="noreferrer">official ↗</a>
                  {r.repository && <><br /><a href={r.repository} target="_blank" rel="noreferrer">repo ↗</a></>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}
