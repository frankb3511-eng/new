// ---------------------------------------------------------------------------
// POST /api/investigate
// Body: { type: 'username'|'domain'|'email'|ip'|'auto', target: string }
// All scanning is server-side; the response is a full EngineResult.
// ---------------------------------------------------------------------------

import { NextResponse } from "next/server";
import { scanUsername } from "@/lib/engines/username";
import { scanDomain } from "@/lib/engines/domain";
import { scanEmail } from "@/lib/engines/email";
import { scanIp } from "@/lib/engines/ip";
import { detectTarget } from "@/lib/detect";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  let body: { type?: string; target?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  const target = (body.target ?? "").trim();
  if (!target || target.length > 256) {
    return NextResponse.json({ error: "Provide a target (max 256 chars)." }, { status: 400 });
  }

  const type = body.type && body.type !== "auto" ? body.type : detectTarget(target);
  if (!type) {
    return NextResponse.json(
      { error: "Could not determine target type. Provide a username, domain, email, or IP." },
      { status: 400 },
    );
  }

  try {
    const result =
      type === "username" ? await scanUsername(target) :
      type === "domain" ? await scanDomain(target) :
      type === "email" ? await scanEmail(target) :
      await scanIp(target);
    return NextResponse.json({ detected: type, result });
  } catch (err) {
    return NextResponse.json(
      { error: `Scan failed: ${err instanceof Error ? err.message : String(err)}` },
      { status: 500 },
    );
  }
}
