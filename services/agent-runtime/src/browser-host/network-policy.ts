import { lookup } from "node:dns/promises";
import { isIP } from "node:net";
import {
  classifyBrowserHost,
  sanitizeBrowserPaneUrl,
  sanitizePublicBrowserUrl,
} from "../../../../shared/agent/sanitize-embedded-browser-url";

export type BrowserNetworkMode = "public" | "pane";

export type PinnedAddress = { address: string; family: 4 | 6 };

export type PinnedDestination = {
  url: string;
  host: string;
  port: number;
  addresses: PinnedAddress[];
};

const RESOLVE_TIMEOUT_MS = 5_000;

function allowPrivateBrowsing(): boolean {
  return process.env.LOCAL_STUDIO_BROWSER_ALLOW_PRIVATE === "1";
}

export function checkBrowserUrl(raw: string, mode: BrowserNetworkMode): string | null {
  let url: URL;
  try {
    url = new URL(raw.trim());
  } catch {
    return null;
  }
  if (!/^(?:http|ws)s?:$/.test(url.protocol)) return null;
  if (url.username || url.password) return null;
  const probe = new URL(url.toString());
  probe.protocol = url.protocol.replace(/^ws/, "http");
  const sanitized =
    mode === "pane"
      ? sanitizeBrowserPaneUrl(probe.toString(), { allowPrivate: allowPrivateBrowsing() })
      : sanitizePublicBrowserUrl(probe.toString());
  return sanitized ? url.toString() : null;
}

function expectedHostClass(
  hostname: string,
  mode: BrowserNetworkMode,
): "public" | "loopback" | "private" {
  const hostClass = classifyBrowserHost(hostname);
  if (hostClass === "blocked") throw new Error(`Browser policy blocked host: ${hostname}`);
  if (hostClass === "private" && !(mode === "pane" && allowPrivateBrowsing())) {
    throw new Error(`Browser policy blocked private host: ${hostname}`);
  }
  if (hostClass === "loopback" && mode !== "pane") {
    throw new Error(`Browser policy blocked loopback host: ${hostname}`);
  }
  return hostClass;
}

async function resolveWithTimeout(hostname: string): Promise<PinnedAddress[]> {
  const resolved = lookup(hostname, { all: true, verbatim: true });
  const timeout = new Promise<never>((_, reject) => {
    const timer = setTimeout(
      () => reject(new Error(`Browser policy DNS resolution timed out for ${hostname}`)),
      RESOLVE_TIMEOUT_MS,
    );
    timer.unref?.();
  });
  const answers = await Promise.race([resolved, timeout]);
  return answers.map((answer) => ({
    address: answer.address,
    family: answer.family === 6 ? 6 : 4,
  }));
}

export async function resolvePinnedDestination(
  raw: string,
  mode: BrowserNetworkMode,
): Promise<PinnedDestination> {
  const vetted = checkBrowserUrl(raw, mode);
  if (!vetted) throw new Error(`Browser policy blocked URL: ${raw}`);
  const url = new URL(vetted);
  const hostname = url.hostname
    .replace(/^\[|\]$/g, "")
    .replace(/\.$/, "")
    .toLowerCase();
  const expected = expectedHostClass(hostname, mode);

  const literalFamily = isIP(hostname);
  const answers: PinnedAddress[] = literalFamily
    ? [{ address: hostname, family: literalFamily === 6 ? 6 : 4 }]
    : await resolveWithTimeout(hostname);
  if (answers.length === 0) throw new Error(`Host resolved to no addresses: ${hostname}`);
  const allowedClasses: string[] =
    expected === "loopback"
      ? ["loopback"]
      : mode === "pane" && allowPrivateBrowsing()
        ? ["public", "private"]
        : [expected];
  for (const answer of answers) {
    if (
      answer.address.includes("%") ||
      !allowedClasses.includes(classifyBrowserHost(answer.address))
    ) {
      throw new Error(`Browser policy blocked resolved address for ${hostname}: ${answer.address}`);
    }
  }
  const ordered =
    expected === "loopback" ? [...answers].sort((a, b) => a.family - b.family) : answers;

  const port = url.port ? Number(url.port) : /^(?:https|wss):$/.test(url.protocol) ? 443 : 80;
  return { url: url.toString(), host: url.host, port, addresses: ordered };
}
