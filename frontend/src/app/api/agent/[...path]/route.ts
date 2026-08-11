import { NextRequest } from "next/server";
import { AGENT_TURN_BODY_LIMIT_BYTES } from "@shared/agent/agent-turn-body";
import { proxyToAgentRuntime } from "@/app/api/agent/proxy-to-runtime";
import { requireApiAccess } from "@/lib/auth/guard";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Method = "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
type Rule = {
  pattern: RegExp;
  methods: readonly Method[];
  authenticated?: boolean;
  bodyLimits?: Partial<Record<Method, number>>;
  crossSiteError?: string;
};

const rules: readonly Rule[] = [
  { pattern: /^abort$/, methods: ["POST"], authenticated: true },
  { pattern: /^automations$/, methods: ["GET", "POST"], authenticated: true },
  { pattern: /^automations\/[^/]+$/, methods: ["PATCH", "DELETE"], authenticated: true },
  { pattern: /^automations\/[^/]+\/run$/, methods: ["POST"], authenticated: true },
  { pattern: /^browser\/(?:fetch|frame|localhosts|state)$/, methods: ["GET"] },
  { pattern: /^browser\/[^/]+$/, methods: ["POST"] },
  { pattern: /^compact$/, methods: ["POST"], authenticated: true },
  { pattern: /^goal$/, methods: ["GET", "PUT", "DELETE"], authenticated: true },
  { pattern: /^models$/, methods: ["GET", "POST"], bodyLimits: { POST: 64 * 1024 } },
  { pattern: /^pr$/, methods: ["GET"], authenticated: true },
  {
    pattern: /^pr\/merge$/,
    methods: ["POST"],
    authenticated: true,
    bodyLimits: { POST: 64 * 1024 },
    crossSiteError: "Cross-site pull-request access rejected",
  },
  { pattern: /^providers$/, methods: ["GET"], authenticated: true },
  { pattern: /^providers\/[^/]+\/(?:login|logout)$/, methods: ["POST"], authenticated: true },
  { pattern: /^providers\/login\/[^/]+$/, methods: ["GET"], authenticated: true },
  {
    pattern: /^providers\/login\/[^/]+\/(?:cancel|respond)$/,
    methods: ["POST"],
    authenticated: true,
  },
  { pattern: /^runtime\/(?:events|sessions|status)$/, methods: ["GET"] },
  {
    pattern: /^runtime\/extension-ui$/,
    methods: ["POST"],
    authenticated: true,
    bodyLimits: { POST: 40_000 },
  },
  { pattern: /^sessions$/, methods: ["GET", "DELETE"] },
  { pattern: /^sessions\/all$/, methods: ["GET"] },
  {
    pattern: /^sessions\/[^/]+$/,
    methods: ["GET", "PATCH"],
    bodyLimits: { PATCH: 64 * 1024 },
  },
  { pattern: /^setup-checks$/, methods: ["GET"] },
  { pattern: /^subagents$/, methods: ["GET", "POST"], authenticated: true },
  {
    pattern: /^turn$/,
    methods: ["POST"],
    authenticated: true,
    bodyLimits: { POST: AGENT_TURN_BODY_LIMIT_BYTES },
  },
];

async function handle(request: NextRequest): Promise<Response> {
  const path = request.nextUrl.pathname.replace(/^\/api\/agent\/?/, "");
  const rule = rules.find((candidate) => candidate.pattern.test(path));
  if (!rule) return Response.json({ error: "Not found" }, { status: 404 });
  const method = request.method as Method;
  if (!rule.methods.includes(method)) {
    return new Response(null, { status: 405, headers: { allow: rule.methods.join(", ") } });
  }
  if (rule.authenticated) {
    const denied = requireApiAccess(request);
    if (denied) return denied;
  }
  if (
    rule.crossSiteError &&
    request.headers.get("sec-fetch-site")?.toLowerCase() === "cross-site"
  ) {
    return Response.json({ error: rule.crossSiteError }, { status: 403 });
  }
  return proxyToAgentRuntime(request, { bodyLimitBytes: rule.bodyLimits?.[method] });
}

export const GET = handle;
export const POST = handle;
export const PUT = handle;
export const PATCH = handle;
export const DELETE = handle;
