import { NextRequest } from "next/server";
import { exchangeGoogleCode } from "@/features/agent/oauth/google-store";
import { installManagedGoogleCatalogueServer } from "@/features/agent/mcp/service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const STATE_COOKIE = "google_oauth_state";
const INSTALL_CATALOGUE_COOKIE = "google_oauth_install_catalogue_id";

function htmlPage(title: string, detail: string, status = 200): Response {
  const body = `<!doctype html><html><head><meta charset="utf-8"><title>${title}</title><style>body{font-family:system-ui,sans-serif;background:#0b0b0c;color:#e7e7ea;display:flex;min-height:100vh;align-items:center;justify-content:center;margin:0}main{max-width:28rem;padding:2rem;text-align:center}h1{font-size:1.1rem;margin:0 0 .5rem}p{color:#a1a1aa;font-size:.9rem;line-height:1.5}</style></head><body><main><h1>${title}</h1><p>${detail}</p><script>setTimeout(function(){window.close()},1500)</script></main></body></html>`;
  return new Response(body, { status, headers: { "content-type": "text/html; charset=utf-8" } });
}

export async function GET(request: NextRequest) {
  const url = request.nextUrl;
  const error = url.searchParams.get("error");
  if (error) {
    return htmlPage("Authorization failed", `Google returned: ${error}`, 400);
  }

  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  const cookieState = request.cookies.get(STATE_COOKIE)?.value;
  if (!code || !state || !cookieState || state !== cookieState) {
    return htmlPage(
      "Authorization failed",
      "Invalid or expired OAuth state. Please try again.",
      400,
    );
  }

  const redirectUri = `${url.origin}/api/oauth/google/callback`;
  try {
    await exchangeGoogleCode(code, redirectUri);
  } catch (exchangeError) {
    const message =
      exchangeError instanceof Error ? exchangeError.message : "Token exchange failed.";
    return htmlPage("Authorization failed", message, 500);
  }

  const catalogueId = request.cookies.get(INSTALL_CATALOGUE_COOKIE)?.value;
  if (catalogueId) {
    const install = installManagedGoogleCatalogueServer(catalogueId);
    if (install.status !== 200) {
      const errorMessage =
        "error" in install.payload && typeof install.payload.error === "string"
          ? install.payload.error
          : "Google connected, but plugin install failed.";
      return htmlPage("Google connected", errorMessage, 500);
    }
  }

  return htmlPage(
    catalogueId ? "Google connected · plugin installed" : "Google connected",
    catalogueId
      ? "vLLM Studio connected Google and installed the managed Google Workspace MCP server. You can close this tab."
      : "vLLM Studio now has a refreshable Google token. You can close this tab.",
  );
}
