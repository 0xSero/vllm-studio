import { afterEach, beforeEach, describe, expect, spyOn, test } from "bun:test";
import {
  ExclusiveLaneNotReadyError,
  assertExclusiveLaneReady,
  resetExclusiveLaneReadyState,
} from "../src/lane-ready";
import { piRuntimeManager } from "../src/pi-runtime";
import * as settingsService from "../src/settings-service";

const SETTINGS = {
  backendUrl: "http://lanes.example:9090/",
  apiKey: "test-api-key",
  voiceUrl: "",
  voiceModel: "whisper-large-v3-turbo",
};

const originalFetch = globalThis.fetch;

type LaneBody = {
  enabled: boolean;
  resident_lane?: string;
  switch?: { state?: string };
};

function jsonResponse(body: unknown, status = 200): Response {
  return Response.json(body, { status });
}

function installFetch(
  impl: (url: string, init?: RequestInit) => Promise<Response> | Response,
): { urls: string[]; inits: Array<RequestInit | undefined> } {
  const urls: string[] = [];
  const inits: Array<RequestInit | undefined> = [];
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url =
      typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    urls.push(url);
    inits.push(init);
    return impl(url, init);
  }) as typeof fetch;
  return { urls, inits };
}

function laneBody(body: LaneBody): LaneBody {
  return {
    enabled: body.enabled,
    resident_lane: body.resident_lane ?? "omlx",
    switch: body.switch ?? { state: "idle" },
  };
}

describe("assertExclusiveLaneReady", () => {
  let settingsSpy: ReturnType<typeof spyOn<typeof settingsService, "getApiSettings">>;

  beforeEach(() => {
    resetExclusiveLaneReadyState();
    settingsSpy = spyOn(settingsService, "getApiSettings").mockResolvedValue({ ...SETTINGS });
  });

  afterEach(() => {
    settingsSpy.mockRestore();
    globalThis.fetch = originalFetch;
    resetExclusiveLaneReadyState();
  });

  test("non-exclusive modelId never GETs / always allows", async () => {
    const calls = installFetch(() => {
      throw new Error("GET /studio/lanes must not run");
    });
    await assertExclusiveLaneReady("amd/AMD-qwen3.8-27b");
    await assertExclusiveLaneReady("anthropic/claude-opus");
    await assertExclusiveLaneReady("laguna-s-2.1");
    expect(calls.urls).toEqual([]);
  });

  test("never-observed GET fail = pass-through", async () => {
    installFetch(() => Promise.reject(new Error("controller down")));
    await assertExclusiveLaneReady("user-pi-ds4/deepseek-v4-flash");
    await assertExclusiveLaneReady("ds4/deepseek-v4-flash");
  });

  test("observed enabled: true then GET fail = 503 lane_status_unavailable", async () => {
    let fail = false;
    installFetch(() => {
      if (fail) return jsonResponse({ error: "down" }, 500);
      return jsonResponse(laneBody({ enabled: true, resident_lane: "ds4" }));
    });
    await assertExclusiveLaneReady("ds4/deepseek-v4-flash");
    resetExclusiveLaneReadyState({ retainLastEnabled: true });
    fail = true;
    await expect(assertExclusiveLaneReady("ds4/deepseek-v4-flash")).rejects.toMatchObject({
      name: "ExclusiveLaneNotReadyError",
      code: "lane_status_unavailable",
      status: 503,
    });
    await expect(assertExclusiveLaneReady("ds4/deepseek-v4-flash")).rejects.toBeInstanceOf(
      ExclusiveLaneNotReadyError,
    );
  });

  test("observed enabled: false then GET fail = pass-through", async () => {
    let fail = false;
    installFetch(() => {
      if (fail) throw new Error("controller down");
      return jsonResponse(laneBody({ enabled: false, resident_lane: "none" }));
    });
    await assertExclusiveLaneReady("user-pi-ds4/deepseek-v4-flash");
    resetExclusiveLaneReadyState({ retainLastEnabled: true });
    fail = true;
    await assertExclusiveLaneReady("user-pi-ds4/deepseek-v4-flash");
  });

  test("enabled + running = 503 lane_switch_in_progress", async () => {
    installFetch(() =>
      jsonResponse(
        laneBody({ enabled: true, resident_lane: "ds4", switch: { state: "running" } }),
      ),
    );
    await expect(assertExclusiveLaneReady("ds4/deepseek-v4-flash")).rejects.toMatchObject({
      code: "lane_switch_in_progress",
      status: 503,
    });
  });

  test("enabled + restoring = 503 lane_switch_in_progress", async () => {
    installFetch(() =>
      jsonResponse(
        laneBody({ enabled: true, resident_lane: "omlx", switch: { state: "restoring" } }),
      ),
    );
    await expect(assertExclusiveLaneReady("omlx/laguna-s-2.1")).rejects.toMatchObject({
      code: "lane_switch_in_progress",
    });
  });

  test("enabled + resident mismatch = 503 lane_not_resident", async () => {
    installFetch(() => jsonResponse(laneBody({ enabled: true, resident_lane: "omlx" })));
    await expect(assertExclusiveLaneReady("user-pi-ds4/deepseek-v4-flash")).rejects.toMatchObject({
      code: "lane_not_resident",
      status: 503,
    });
  });

  test("enabled + conflict resident rejects exclusive ids", async () => {
    installFetch(() => jsonResponse(laneBody({ enabled: true, resident_lane: "conflict" })));
    await expect(assertExclusiveLaneReady("omlx/laguna-s-2.1")).rejects.toMatchObject({
      code: "lane_not_resident",
    });
  });

  test("enabled + matching resident allows", async () => {
    installFetch(() => jsonResponse(laneBody({ enabled: true, resident_lane: "ds4" })));
    await assertExclusiveLaneReady("user-pi-ds4/deepseek-v4-flash");
  });

  test("enabled: false does not reject a mismatch or in-flight switch", async () => {
    installFetch(() =>
      jsonResponse(
        laneBody({ enabled: false, resident_lane: "omlx", switch: { state: "running" } }),
      ),
    );
    await assertExclusiveLaneReady("ds4/deepseek-v4-flash");
  });

  test("GETs settings backendUrl /studio/lanes with the api key", async () => {
    const calls = installFetch(() =>
      jsonResponse(laneBody({ enabled: true, resident_lane: "ds4" })),
    );
    await assertExclusiveLaneReady("ds4/deepseek-v4-flash");
    expect(calls.urls).toEqual(["http://lanes.example:9090/studio/lanes"]);
    expect(new Headers(calls.inits[0]?.headers).get("Authorization")).toBe("Bearer test-api-key");
  });

  test("coalesces in-flight GETs", async () => {
    let resolveResponse: ((response: Response) => void) | undefined;
    const pending = new Promise<Response>((resolve) => {
      resolveResponse = resolve;
    });
    const calls = installFetch(() => pending);
    const first = assertExclusiveLaneReady("ds4/deepseek-v4-flash");
    const second = assertExclusiveLaneReady("user-pi-ds4/deepseek-v4-flash");
    resolveResponse!(jsonResponse(laneBody({ enabled: true, resident_lane: "ds4" })));
    await Promise.all([first, second]);
    expect(calls.urls).toHaveLength(1);
  });

  test("reuses a 1s cache instead of GETting again", async () => {
    const calls = installFetch(() =>
      jsonResponse(laneBody({ enabled: true, resident_lane: "ds4" })),
    );
    await assertExclusiveLaneReady("ds4/deepseek-v4-flash");
    await assertExclusiveLaneReady("ds4/deepseek-v4-flash");
    expect(calls.urls).toHaveLength(1);
  });
});

describe("PiSdkSession.ensureStarted lane gate", () => {
  let settingsSpy: ReturnType<typeof spyOn<typeof settingsService, "getApiSettings">>;

  beforeEach(() => {
    resetExclusiveLaneReadyState();
    settingsSpy = spyOn(settingsService, "getApiSettings").mockResolvedValue({ ...SETTINGS });
  });

  afterEach(() => {
    settingsSpy.mockRestore();
    globalThis.fetch = originalFetch;
    resetExclusiveLaneReadyState();
  });

  test("rejects exclusive-lane ensureStarted while switching before fingerprint short-circuit", async () => {
    installFetch(() =>
      jsonResponse(
        laneBody({ enabled: true, resident_lane: "ds4", switch: { state: "running" } }),
      ),
    );
    await expect(
      piRuntimeManager.getSession("lane-ready-gate").ensureStarted("ds4/deepseek-v4-flash"),
    ).rejects.toMatchObject({
      code: "lane_switch_in_progress",
      status: 503,
    });
  });
});
