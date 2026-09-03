// ---------------------------------------------------------------------------
// POST /api/image
// multipart/form-data with a single image file.
// 100% local analysis: perceptual hash + EXIF/metadata extraction.
// Nothing is sent to any third party.
// ---------------------------------------------------------------------------

import { NextResponse } from "next/server";
import { decodeImage, perceptualHashes, hashToString } from "@/lib/image";
import { extractMetadata } from "@/lib/metadata";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const form = await req.formData().catch(() => null);
  const file = form?.get("file");
  if (!(file instanceof File)) {
    return NextResponse.json({ error: "Upload an image file under field name 'file'." }, { status: 400 });
  }
  if (file.size > 25 * 1024 * 1024) {
    return NextResponse.json({ error: "Image too large (max 25MB)." }, { status: 400 });
  }

  const buffer = Buffer.from(await file.arrayBuffer());
  const contentType = file.type || undefined;
  const started = Date.now();

  // Perceptual hashing (decodes JPEG/PNG locally; other formats reported).
  const decoded = decodeImage(buffer, contentType);
  const hashes = decoded
    ? {
        ahash: hashToString(perceptualHashes(decoded).ahash),
        dhash: hashToString(perceptualHashes(decoded).dhash),
        width: decoded.width,
        height: decoded.height,
      }
    : null;

  // Metadata (EXIF/XMP/ICC/GPS).
  const { metadata, gps, warnings } = await extractMetadata({ buffer, name: file.name });

  return NextResponse.json({
    fileName: file.name,
    contentType: file.type,
    bytes: file.size,
    hashSupported: !!decoded,
    hashes,
    gps,
    metadata,
    warnings: hashes ? warnings : [...warnings, "Perceptual hashing: format not supported locally (JPEG/PNG); metadata extraction attempted."],
    elapsedMs: Date.now() - started,
    note: "Analysis ran entirely on this server. The image was not sent to any external service.",
  });
}
