// GET /api/sources - returns the integration registry (for the UI matrix).
import { NextResponse } from "next/server";
import { INTEGRATIONS, statusLabel } from "@/lib/registry";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  return NextResponse.json({
    generated: new Date().toISOString(),
    count: INTEGRATIONS.length,
    sources: INTEGRATIONS.map((i) => ({
      ...i,
      statusLabel: statusLabel(i.status),
    })),
  });
}
