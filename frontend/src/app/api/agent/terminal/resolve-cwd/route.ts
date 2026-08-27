import { statSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { NextRequest } from "next/server";
import { requireApiAccess } from "@/lib/auth/guard";
import { Schema } from "effect";

const ResolveCwdInputSchema = Schema.Struct({
  target: Schema.optional(Schema.String),
  from: Schema.optional(Schema.String),
  previous: Schema.optional(Schema.String),
});

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function expandTilde(target: string): string {
  if (target === "~") return os.homedir();
  if (target.startsWith("~/")) return path.join(os.homedir(), target.slice(2));
  return target;
}

function resolveCwd(target: string, from: string, previous: string): string | Response {
  if (!target || target === "~") return os.homedir();
  if (target === "-") {
    return previous || Response.json({ ok: false, error: "OLDPWD not set" }, { status: 400 });
  }
  if (target.startsWith("~")) return expandTilde(target);
  if (path.isAbsolute(target)) return target;
  if (!from || !path.isAbsolute(from)) {
    return Response.json({ ok: false, error: "from must be absolute" }, { status: 400 });
  }
  return path.resolve(from, target);
}

export async function POST(request: NextRequest) {
  const denied = requireApiAccess(request);
  if (denied) return denied;
  let body: typeof ResolveCwdInputSchema.Type;
  try {
    body = Schema.decodeUnknownSync(ResolveCwdInputSchema)(await request.json());
  } catch {
    return Response.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  const target = body.target?.trim() ?? "";
  const from = body.from?.trim() ?? "";
  const previous = body.previous?.trim() ?? "";

  const next = resolveCwd(target, from, previous);
  if (next instanceof Response) return next;

  try {
    if (!statSync(next).isDirectory())
      return Response.json({ ok: false, error: `not a directory: ${next}` }, { status: 400 });
  } catch {
    return Response.json(
      { ok: false, error: `no such file or directory: ${next}` },
      {
        status: 404,
      },
    );
  }
  return Response.json({ ok: true, cwd: next });
}
