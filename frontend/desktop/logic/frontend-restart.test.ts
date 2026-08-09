import { describe, expect, test } from "bun:test";
import { resolveFrontendRestartUrl } from "./frontend-restart";

describe("desktop frontend restart", () => {
  test("preserves the active agent route", () => {
    expect(
      resolveFrontendRestartUrl(
        "http://127.0.0.1:49782",
        "http://127.0.0.1:49782/agent?session=active#terminal",
      ),
    ).toBe("http://127.0.0.1:49782/agent?session=active#terminal");
  });

  test("preserves the route when the local port changes", () => {
    expect(
      resolveFrontendRestartUrl(
        "http://127.0.0.1:50000",
        "http://127.0.0.1:49782/agent?session=active",
      ),
    ).toBe("http://127.0.0.1:50000/agent?session=active");
  });

  test("does not carry an external route into the desktop origin", () => {
    expect(
      resolveFrontendRestartUrl(
        "http://127.0.0.1:49782",
        "https://example.com/agent?session=active",
      ),
    ).toBe("http://127.0.0.1:49782");
  });

  test("uses the desktop origin when the previous URL is invalid", () => {
    expect(resolveFrontendRestartUrl("http://127.0.0.1:49782", "invalid")).toBe(
      "http://127.0.0.1:49782",
    );
  });
});
