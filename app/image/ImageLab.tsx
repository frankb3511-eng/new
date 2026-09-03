"use client";

import { useRef, useState } from "react";

interface ImageResult {
  fileName: string;
  contentType: string;
  bytes: number;
  hashSupported: boolean;
  hashes: { ahash: string; dhash: string; width: number; height: number } | null;
  gps: { latitude: number; longitude: number; googleMapsUrl: string; osmUrl: string } | null;
  metadata: Record<string, unknown>;
  warnings: string[];
  elapsedMs: number;
}

export default function ImageLab() {
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<ImageResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [drag, setDrag] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  async function handleFile(file: File) {
    setLoading(true);
    setError(null);
    setResult(null);
    try {
      const fd = new FormData();
      fd.append("file", file);
      const res = await fetch("/api/image", { method: "POST", body: fd });
      const json = await res.json();
      if (!res.ok) setError(json.error ?? "Analysis failed");
      else setResult(json);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }

  const highlights = (result?.metadata?.__highlights as Record<string, unknown>) ?? {};

  return (
    <>
      <div
        className={`dropzone ${drag ? "drag" : ""}`}
        onClick={() => inputRef.current?.click()}
        onDragOver={(e) => { e.preventDefault(); setDrag(true); }}
        onDragLeave={() => setDrag(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDrag(false);
          const f = e.dataTransfer.files?.[0];
          if (f) handleFile(f);
        }}
      >
        {loading ? <><span className="spinner" /> Decoding & hashing locally…</> : "Drop an image here or click to choose (JPEG / PNG / WebP / TIFF, max 25MB)"}
        <input
          ref={inputRef}
          type="file"
          accept="image/*"
          style={{ display: "none" }}
          onChange={(e) => { const f = e.target.files?.[0]; if (f) handleFile(f); }}
        />
      </div>

      {error && <div className="warn-box" style={{ borderColor: "rgba(248,113,113,0.4)" }}>⚠ {error}</div>}

      {result && (
        <>
          <div className="summary-bar">
            <div className="stat"><div className="num">{result.hashes ? "✓" : "—"}</div><div className="lbl">pHash</div></div>
            <div className="stat"><div className="num">{result.gps ? "✓" : "—"}</div><div className="lbl">GPS found</div></div>
            <div className="stat"><div className="num">{Object.keys(highlights).length}</div><div className="lbl">notable fields</div></div>
            <div className="stat"><div className="num">{(result.elapsedMs / 1000).toFixed(2)}s</div><div className="lbl">local processing</div></div>
          </div>

          {result.hashes && (
            <div className="card">
              <h3 style={{ marginTop: 0 }}>Perceptual hashes (64-bit)</h3>
              <dl className="kv">
                <dt>aHash (average)</dt><dd><code>{result.hashes.ahash}</code></dd>
                <dt>dHash (difference)</dt><dd><code>{result.hashes.dhash}</code></dd>
                <dt>Dimensions</dt><dd>{result.hashes.width} × {result.hashes.height}</dd>
              </dl>
              <p className="muted" style={{ fontSize: 12.5 }}>
                In username scans, avatars from every found profile are hashed this way and compared —
                Hamming distance ≤ ~5 bits (dHash) means the same photo even across resizes/compression.
              </p>
            </div>
          )}

          {result.gps && (
            <div className="gps-box">
              <strong>📍 GPS coordinates embedded</strong>
              <div className="muted" style={{ margin: "4px 0" }}>
                {result.gps.latitude.toFixed(6)}, {result.gps.longitude.toFixed(6)}
              </div>
              <a href={result.gps.googleMapsUrl} target="_blank" rel="noreferrer">Open in Google Maps</a>{" · "}
              <a href={result.gps.osmUrl} target="_blank" rel="noreferrer">Open in OpenStreetMap</a>
            </div>
          )}

          {Object.keys(highlights).length > 0 && (
            <div className="card">
              <h3 style={{ marginTop: 0 }}>Notable metadata</h3>
              <dl className="kv">
                {Object.entries(highlights).map(([k, v]) => (
                  <span key={k} style={{ display: "contents" }}>
                    <dt>{k}</dt><dd>{String(v)}</dd>
                  </span>
                ))}
              </dl>
            </div>
          )}

          {result.warnings.length > 0 && (
            <div className="warn-box">
              {result.warnings.map((w, i) => <div key={i}>ℹ {w}</div>)}
            </div>
          )}

          <details>
            <summary>Full raw metadata</summary>
            <pre>{JSON.stringify(Object.fromEntries(Object.entries(result.metadata).filter(([k]) => !k.startsWith("__"))), null, 2)}</pre>
          </details>
        </>
      )}
    </>
  );
}
