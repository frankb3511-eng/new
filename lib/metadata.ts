// ---------------------------------------------------------------------------
// LOCAL image/file metadata extraction (EXIF / XMP / ICC / GPS).
// Uses exifr, runs entirely locally.
// ---------------------------------------------------------------------------

import exifr from "exifr";

export interface ExtractedMetadata {
  [key: string]: unknown;
}

export interface GpsSummary {
  latitude?: number;
  longitude?: number;
  googleMapsUrl?: string;
  osmUrl?: string;
}

export async function extractMetadata(file: {
  buffer: Buffer;
  name?: string;
}): Promise<{ metadata: ExtractedMetadata; gps?: GpsSummary; warnings: string[] }> {
  const warnings: string[] = [];
  let metadata: ExtractedMetadata = {};
  try {
    const parsed = await exifr.parse(file.buffer, {
      tiff: true,
      exif: true,
      gps: true,
      xmp: true,
      icc: true,
      iptc: true,
      jfif: true,
      ihdr: true,
      translateValues: true,
      reviveValues: true,
      mergeOutput: true,
    });
    if (parsed && typeof parsed === "object") {
      metadata = JSON.parse(JSON.stringify(parsed, (_k, v) => (typeof v === "bigint" ? v.toString() : v)));
    }
  } catch (err) {
    // Most "stripped" social-media images land here - that is expected.
    warnings.push(
      `No structured metadata found (${err instanceof Error ? err.message : "unsupported/stripped"}). ` +
        `This is normal for images downloaded from social platforms, which strip EXIF on upload.`,
    );
  }

  // Pull out GPS into a convenient summary.
  let gps: GpsSummary | undefined;
  const latitude = (metadata.latitude as number | undefined) ?? (metadata.GPSLatitude as number | undefined);
  const longitude = (metadata.longitude as number | undefined) ?? (metadata.GPSLongitude as number | undefined);
  if (typeof latitude === "number" && typeof longitude === "number" && Number.isFinite(latitude) && Number.isFinite(longitude)) {
    gps = {
      latitude,
      longitude,
      googleMapsUrl: `https://www.google.com/maps?q=${latitude},${longitude}`,
      osmUrl: `https://www.openstreetmap.org/?mlat=${latitude}&mlon=${longitude}#map=15/${latitude}/${longitude}`,
    };
  }

  // Highlight fields that commonly leak information.
  const interestingKeys = [
    "Make", "Model", "Software", "DateTimeOriginal", "CreateDate", "ModifyDate",
    "Artist", "Copyright", "OwnerName", "CameraOwnerName", "GPSLatitude",
    "GPSLongitude", "LocationName", "Sublocation", "City", "Country",
    "HostComputer", "InternalSerialNumber", "SerialNumber", "BodySerialNumber",
    "LensModel", "UserComment", "ImageDescription",
  ];
  const highlights: Record<string, unknown> = {};
  for (const key of interestingKeys) {
    if (key in metadata) highlights[key] = metadata[key];
  }
  if (Object.keys(highlights).length) {
    metadata.__highlights = highlights;
  }
  metadata.__gps = gps ?? null;

  return { metadata, gps, warnings };
}
