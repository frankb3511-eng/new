// ---------------------------------------------------------------------------
// LOCAL image analysis: perceptual hashes (aHash/dHash/pHash) + metadata.
// Everything here runs locally - images are decoded in-process with pure-JS
// decoders (jpeg-js, pngjs) / built-in (WebP/AVIF via next runtime decoders
// where available), no third-party image service is involved.
// ---------------------------------------------------------------------------

import jpeg from "jpeg-js";
import { PNG } from "pngjs";

export interface DecodedImage {
  width: number;
  height: number;
  /** RGBA pixels, length = width*height*4 */
  data: Uint8Array | Buffer;
}

/** Decode common image formats into raw RGBA. Returns null if unsupported. */
export function decodeImage(buffer: Buffer, contentType?: string): DecodedImage | null {
  // JPEG
  if (contentType?.includes("jpeg") || looksLikeJpeg(buffer)) {
    try {
      const decoded = jpeg.decode(buffer, { maxMemoryUsageInMB: 512, formatAsRGBA: true });
      return { width: decoded.width, height: decoded.height, data: decoded.data };
    } catch {
      /* fall through */
    }
  }
  // PNG
  if (contentType?.includes("png") || looksLikePng(buffer)) {
    try {
      const png = PNG.sync.read(buffer);
      return { width: png.width, height: png.height, data: png.data };
    } catch {
      /* fall through */
    }
  }
  // Other formats (webp/gif/avif/tiff): attempt decode through sharp-free path.
  // Node 22 lacks a built-in image decoder; report unsupported honestly.
  return null;
}

function looksLikeJpeg(b: Buffer): boolean {
  return b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff;
}
function looksLikePng(b: Buffer): boolean {
  return (
    b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47 && b[4] === 0x0d && b[5] === 0x0a
  );
}

/** Average-pool resize to NxN grayscale (nearest neighbour, deterministic). */
export function toGrayGrid(img: DecodedImage, n: number): number[] {
  const grid = new Array<number>(n * n);
  const { width: w, height: h, data } = img;
  for (let y = 0; y < n; y++) {
    for (let x = 0; x < n; x++) {
      // sample the center of each destination cell
      const sx = Math.min(w - 1, Math.floor(((x + 0.5) / n) * w));
      const sy = Math.min(h - 1, Math.floor(((y + 0.5) / n) * h));
      const idx = (sy * w + sx) * 4;
      const r = data[idx];
      const g = data[idx + 1];
      const b = data[idx + 2];
      // Rec. 601 luma
      grid[y * n + x] = 0.299 * r + 0.587 * g + 0.114 * b;
    }
  }
  return grid;
}

/** Average hash (aHash): 64-bit, compares against mean brightness. */
export function aHash(img: DecodedImage, size = 8): bigint {
  const gray = toGrayGrid(img, size);
  const mean = gray.reduce((a, b) => a + b, 0) / gray.length;
  let hash = 0n;
  for (let i = 0; i < size * size; i++) {
    if (gray[i] >= mean) hash |= 1n << BigInt(i);
  }
  return hash;
}

/** Difference hash (dHash): 64-bit, compares adjacent pixels (gradient). */
export function dHash(img: DecodedImage, size = 9): bigint {
  // 9x9 grid -> 8x8 differences
  const gray = toGrayGrid(img, size);
  let hash = 0n;
  let bit = 0;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size - 1; x++) {
      const left = gray[y * size + x];
      const right = gray[y * size + x + 1];
      if (left > right) hash |= 1n << BigInt(bit);
      bit++;
    }
  }
  return hash;
}

/** Hamming distance between two 64-bit hashes. */
export function hammingDistance(a: bigint, b: bigint): number {
  let x = a ^ b;
  let count = 0;
  while (x) {
    count += Number(x & 1n);
    x >>= 1n;
  }
  return count;
}

/**
 * Perceptual similarity score 0..1 combining dHash (primary) and aHash.
 * <=5 bits on dHash ~ same image; <=10 ~ visually similar.
 */
export function imageSimilarity(hashA: PerceptualHashes, hashB: PerceptualHashes): number {
  const d = hammingDistance(hashA.dhash, hashB.dhash);
  const ah = hammingDistance(hashA.ahash, hashB.ahash);
  const dScore = Math.max(0, 1 - d / 20); // 0 bits -> 1, 20+ bits -> 0
  const aScore = Math.max(0, 1 - ah / 24);
  return Math.round((0.7 * dScore + 0.3 * aScore) * 100) / 100;
}

export interface PerceptualHashes {
  ahash: bigint;
  dhash: bigint;
}

export function perceptualHashes(img: DecodedImage): PerceptualHashes {
  return { ahash: aHash(img), dhash: dHash(img) };
}

export function hashToString(h: bigint): string {
  return h.toString(16).padStart(16, "0");
}

/** Download an avatar/image and compute hashes. Null = fetch or decode failed. */
export async function hashImageUrl(
  url: string,
  fetchImpl: typeof fetch = fetch,
  timeoutMs = 8000,
): Promise<{ hashes: PerceptualHashes; contentType: string | null; bytes: number } | null> {
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    const res = await fetchImpl(url, {
      signal: controller.signal,
      headers: {
        "User-Agent": "keyless-osint-workbench/1.0 (local image correlation)",
      },
    });
    clearTimeout(timer);
    if (!res.ok) return null;
    const contentType = res.headers.get("content-type");
    const buf = Buffer.from(await res.arrayBuffer());
    const decoded = decodeImage(buf, contentType ?? undefined);
    if (!decoded) return null;
    return { hashes: perceptualHashes(decoded), contentType, bytes: buf.length };
  } catch {
    return null;
  }
}
