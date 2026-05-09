import { NextResponse } from "next/server";
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";
import { resolvePiBinaryPath } from "@/lib/agent/pi-binary";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const piPath = resolvePiBinaryPath();
  const codexDir = path.join(homedir(), ".codex");
  const piDir = path.join(homedir(), ".pi");
  return NextResponse.json({
    checks: [
      {
        id: "pi",
        label: "Pi agent binary",
        ok: Boolean(piPath),
        value: piPath ?? "missing",
        guidance:
          "Install app dependencies or install @mariozechner/pi-coding-agent so `pi` is available.",
      },
      {
        id: "pi-dir",
        label: "Pi data directory",
        ok: existsSync(piDir),
        value: piDir,
        guidance: "The directory is created after the first Pi run.",
      },
      {
        id: "codex-dir",
        label: "Codex config directory",
        ok: existsSync(codexDir),
        value: codexDir,
        guidance: "Optional but recommended for plugins and skills parity.",
      },
    ],
  });
}
