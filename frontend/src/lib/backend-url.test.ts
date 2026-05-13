import { beforeEach, describe, expect, it } from "vitest";
import { clearStoredBackendUrl, getStoredBackendUrl, setStoredBackendUrl } from "./backend-url";

describe("backend URL persistence", () => {
  beforeEach(() => {
    const values = new Map<string, string>();
    Object.defineProperty(window, "localStorage", {
      configurable: true,
      value: {
        getItem: (key: string) => values.get(key) ?? null,
        setItem: (key: string, value: string) => values.set(key, value),
        removeItem: (key: string) => values.delete(key),
      },
    });
    document.cookie = "vllmstudio_backend_url=; Path=/; Max-Age=0";
  });

  it("round-trips a trimmed URL through localStorage and cookie fallback", () => {
    setStoredBackendUrl("  http://127.0.0.1:8080  ");

    expect(window.localStorage.getItem("vllmstudio_backend_url")).toBe("http://127.0.0.1:8080");
    expect(getStoredBackendUrl()).toBe("http://127.0.0.1:8080");

    window.localStorage.removeItem("vllmstudio_backend_url");
    expect(getStoredBackendUrl()).toBe("http://127.0.0.1:8080");
  });

  it("clears both localStorage and cookie-backed values", () => {
    setStoredBackendUrl("http://localhost:8080");
    clearStoredBackendUrl();

    expect(window.localStorage.getItem("vllmstudio_backend_url")).toBeNull();
    expect(getStoredBackendUrl()).toBe("");
  });
});
