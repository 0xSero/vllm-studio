import { getAllOAuthStatuses } from "@/features/agent/oauth/oauth-store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  return Response.json({ providers: await getAllOAuthStatuses() });
}
