import { NextRequest, NextResponse } from "next/server";
import { Schema } from "effect";
import {
  applySettingsUpdate,
  getApiSettings,
  InvalidSettingsError,
  maskedSettingsView,
} from "@local-studio/agent-runtime/settings-service";
import { requireApiAccess } from "@/lib/auth/guard";

export const runtime = "nodejs";

const ApiSettingsUpdateSchema = Schema.Struct({
  backendUrl: Schema.optional(Schema.String),
  apiKey: Schema.optional(Schema.String),
});
type ApiSettingsUpdate = typeof ApiSettingsUpdateSchema.Type;

export async function GET() {
  try {
    return NextResponse.json(maskedSettingsView(await getApiSettings()));
  } catch (error) {
    return NextResponse.json(
      { error: "Failed to load settings", details: String(error) },
      { status: 500 },
    );
  }
}

export async function POST(request: NextRequest) {
  const denied = requireApiAccess(request);
  if (denied) return denied;
  try {
    const update: ApiSettingsUpdate = Schema.decodeUnknownSync(ApiSettingsUpdateSchema)(
      await request.json(),
    );
    const saved = await applySettingsUpdate(update);
    return NextResponse.json({ success: true, ...maskedSettingsView(saved) });
  } catch (error) {
    if (error instanceof InvalidSettingsError) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }
    return NextResponse.json(
      { error: "Failed to save settings", details: String(error) },
      { status: 500 },
    );
  }
}
