// CRITICAL
/**
 * Normalize and allow-list URLs for the Computer embedded browser.
 * Public URLs align loosely with controller browser_open_url rules
 * (no loopback / private nets). Local file URLs are intentionally separate so
 * agent/browser-tool and server-side fetch paths cannot accidentally read disk.
 */
function parseUrl(raw: string): URL | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;
  try {
    return new URL(trimmed);
  } catch {
    return null;
  }
}

export function sanitizePublicBrowserUrl(raw: string): string | null {
  const url = parseUrl(raw);
  if (!url) return null;
  if (url.protocol !== "http:" && url.protocol !== "https:") return null;

  const host = url.hostname.toLowerCase();
  if (host === "localhost" || host.endsWith(".localhost") || host.endsWith(".local")) {
    return null;
  }

  const ipv4 = host.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (ipv4) {
    const a = Number(ipv4[1]);
    const b = Number(ipv4[2]);
    if ([a, b, Number(ipv4[3]), Number(ipv4[4])].some((n) => n < 0 || n > 255)) return null;
    if (a === 10 || a === 127 || a === 0) return null;
    if (a === 169 && b === 254) return null;
    if (a === 172 && b >= 16 && b <= 31) return null;
    if (a === 192 && b === 168) return null;
    if (a === 100 && b >= 64 && b <= 127) return null;
    if (a === 198 && (b === 18 || b === 19)) return null;
    if (a >= 224) return null;
  }

  if (host.includes(":")) {
    const h = host.replace(/^\[|\]$/g, "").toLowerCase();
    if (h === "::1" || h === "::") return null;
    if (h.startsWith("fc") || h.startsWith("fd")) return null;
    if (h.startsWith("fe8") || h.startsWith("fe9") || h.startsWith("fea") || h.startsWith("feb"))
      return null;
  }

  return url.toString();
}

export function sanitizeLocalFileUrl(raw: string): string | null {
  const url = parseUrl(raw);
  if (!url || url.protocol !== "file:") return null;
  const host = url.hostname.toLowerCase();
  if (host && host !== "localhost") return null;
  return url.toString();
}
