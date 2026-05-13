import { describe, expect, it } from "vitest";
import { sanitizeLocalFileUrl, sanitizePublicBrowserUrl } from "./sanitize-embedded-browser-url";

describe("embedded browser url sanitizers", () => {
  it("normalizes public http URLs", () => {
    expect(sanitizePublicBrowserUrl(" https://Example.com/path?q=1 ")).toBe(
      "https://example.com/path?q=1",
    );
    expect(sanitizePublicBrowserUrl("http://93.184.216.34/")).toBe("http://93.184.216.34/");
  });

  it("blocks non-public schemes, local names, private IPv4, and private IPv6", () => {
    expect(sanitizePublicBrowserUrl("file:///tmp/readme.md")).toBeNull();
    expect(sanitizePublicBrowserUrl("https://localhost")).toBeNull();
    expect(sanitizePublicBrowserUrl("https://printer.local")).toBeNull();
    expect(sanitizePublicBrowserUrl("http://10.0.0.1")).toBeNull();
    expect(sanitizePublicBrowserUrl("http://172.16.0.1")).toBeNull();
    expect(sanitizePublicBrowserUrl("http://192.168.1.1")).toBeNull();
    expect(sanitizePublicBrowserUrl("http://100.64.0.1")).toBeNull();
    expect(sanitizePublicBrowserUrl("http://999.1.1.1")).toBeNull();
    expect(sanitizePublicBrowserUrl("http://[::1]")).toBeNull();
    expect(sanitizePublicBrowserUrl("http://[fd00::1]")).toBeNull();
    expect(sanitizePublicBrowserUrl("http://[fe80::1]")).toBeNull();
  });

  it("allows only local file URLs with empty or localhost hosts", () => {
    expect(sanitizeLocalFileUrl("file:///tmp/readme.md")).toBe("file:///tmp/readme.md");
    expect(sanitizeLocalFileUrl("file://localhost/tmp/readme.md")).toBe("file:///tmp/readme.md");
    expect(sanitizeLocalFileUrl("https://example.com/readme.md")).toBeNull();
    expect(sanitizeLocalFileUrl("file://server/share/readme.md")).toBeNull();
  });
});
