import { requireApiAccess } from "@/lib/auth/guard";
import type { NextRequest } from "next/server";
import { Schema } from "effect";

const ReleaseManifestSchema = Schema.Struct({ version: Schema.optional(Schema.String) });

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Every release publishes Local-Studio-release.json alongside the signed
// assets, so "what is the newest version" is one small fetch with no GitHub
// API rate limits. The stable-name DMG below always points at that release.
const RELEASE_BASE = "https://github.com/sybil-solutions/local-studio/releases/latest/download";
const LATEST_DMG_URL = `${RELEASE_BASE}/Local-Studio-arm64.dmg`;

const CACHE_MS = 10 * 60 * 1000;
let cached: { at: number; latest: string | null } | null = null;

export async function GET(request: NextRequest) {
  const denied = requireApiAccess(request);
  if (denied) return denied;
  if (!cached || Date.now() - cached.at > CACHE_MS) {
    let latest: string | null = null;
    try {
      const response = await fetch(`${RELEASE_BASE}/Local-Studio-release.json`, {
        cache: "no-store",
        signal: AbortSignal.timeout(8_000),
      });
      const manifest = Schema.decodeUnknownSync(ReleaseManifestSchema)(await response.json());
      if (response.ok && manifest.version) latest = manifest.version;
    } catch {
      // Offline or GitHub unreachable — report "unknown" and retry after the TTL.
    }
    cached = { at: Date.now(), latest };
  }
  return Response.json({ latest: cached.latest, downloadUrl: LATEST_DMG_URL });
}
