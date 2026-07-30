import { NextRequest, NextResponse } from "next/server";
import {
  SetupCommissioningProbeInputSchema,
  SetupCommissioningSaveSchema,
} from "@local-studio/contracts/setup-commissioning";
import { Schema } from "effect";
import { requireApiAccess } from "@/lib/auth/guard";
import {
  loadSetupCommissioningProfile,
  saveSetupCommissioningProfile,
  updateSetupCommissioningProbe,
} from "@/lib/setup-commissioning-store";
import { probeSetupTarget } from "@/lib/setup-commissioning-probe";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const decodeSave = Schema.decodeUnknownSync(SetupCommissioningSaveSchema, {
  onExcessProperty: "error",
});
const decodeProbe = Schema.decodeUnknownSync(SetupCommissioningProbeInputSchema, {
  onExcessProperty: "error",
});

const denied = (message: string, status = 400) => NextResponse.json({ error: message }, { status });

const boundedJson = async (request: NextRequest, maximum: number): Promise<unknown> => {
  const declared = Number(request.headers.get("content-length") ?? 0);
  if (declared > maximum) throw new Error("Commissioning request body is too large");
  const text = await request.text();
  if (Buffer.byteLength(text, "utf8") > maximum) {
    throw new Error("Commissioning request body is too large");
  }
  return JSON.parse(text) as unknown;
};

export async function GET(request: NextRequest) {
  const rejection = await requireApiAccess(request);
  if (rejection) return rejection;
  try {
    return NextResponse.json(await loadSetupCommissioningProfile());
  } catch {
    return denied("Commissioning profile could not be loaded", 500);
  }
}

export async function PUT(request: NextRequest) {
  const rejection = await requireApiAccess(request);
  if (rejection) return rejection;
  try {
    return NextResponse.json(
      await saveSetupCommissioningProfile(decodeSave(await boundedJson(request, 64 * 1024))),
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : "Commissioning profile is invalid";
    return denied(message, message.includes("changed") ? 409 : 400);
  }
}

export async function POST(request: NextRequest) {
  const rejection = await requireApiAccess(request);
  if (rejection) return rejection;
  let target: ReturnType<typeof decodeProbe>["target"];
  try {
    target = decodeProbe(await boundedJson(request, 1024)).target;
  } catch {
    return denied("Commissioning probe target is invalid");
  }
  const profile = await loadSetupCommissioningProfile();
  return NextResponse.json(
    await updateSetupCommissioningProbe(target, await probeSetupTarget(profile, target)),
  );
}
