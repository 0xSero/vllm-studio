import { NextResponse } from "next/server";
import { existsSync } from "node:fs";
import { access } from "node:fs/promises";
import { constants } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function executableOnPath(name: string): Promise<string | null> {
  const paths = (process.env.PATH ?? "").split(path.delimiter).filter(Boolean);
  for (const dir of paths) {
    const candidate = path.join(dir, name);
    try {
      await access(candidate, constants.X_OK);
      return candidate;
    } catch {
      // keep looking
    }
  }
  return null;
}

export async function GET() {
  const localPi = path.join(process.cwd(), "node_modules", ".bin", "pi");
  const piPath = existsSync(localPi) ? localPi : await executableOnPath("pi");
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
