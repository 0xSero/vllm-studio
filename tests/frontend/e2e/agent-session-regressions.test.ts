import assert from "node:assert/strict";
import test from "node:test";
import { convertMessages } from "../../../frontend/node_modules/@earendil-works/pi-ai/dist/providers/openai-completions.js";
import {
  mergeActiveAgentSessions,
  type ActiveAgentSessionSnapshot,
} from "@/lib/agent/active-sessions";
import { runBrowserPanelCommand } from "@/lib/agent/browser/command";
import { normalizeBrowserInput } from "@/lib/agent/tools/browser-url";
import { controlTargetHasActiveTurn } from "@/lib/agent/control-routing";
import { hasExplicitSessionNavigation } from "@/hooks/agent/use-workspace-hydration-effects";
import {
  initialRuntimeStatusPhase,
  replayAfterCursor,
  shouldSendTrailingIdleStatus,
} from "@/app/api/agent/runtime/events/stream-order";
import {
  detectComposerMention,
  selectedContextInstructions,
  selectedContextPrompt,
} from "@/lib/agent/composer-context";
import { parseAgentTurnCommandResult } from "@/lib/agent/contracts/turn";
import {
  compactionTokensBefore,
  contextUsageAwaitingFreshCompactionUsage,
  normalizeSdkMessageTimestampsForCompactionBoundary,
  piEventIsSuccessfulCompaction,
  postCompactionUsageIsFresh,
} from "@/lib/agent/pi-runtime-compaction";
import { findRuntimeSessionForLookup } from "@/lib/agent/pi-runtime-lookup";
import { piStatusFromEvents } from "@/lib/agent/pi-runtime-state";
import { modelsToPiModels, normalizeOpenAIModels } from "@/lib/agent/models";
import { applyAssistantPiEventToBlocks } from "@/lib/agent/session/block-event";
import { runtimeStatusLooksActive } from "@/lib/agent/session/helpers";
import { blocksFromTurnSnapshots } from "@/lib/agent/session/message-content";
import { replaySessionEvents } from "@/lib/agent/session/replay";
import {
  reduceSessionEvent,
  type SessionStreamContext,
} from "@/lib/agent/sessions/pi-event-applier";
import { drainQueueAfterAgentEnd } from "@/lib/agent/session/helpers";
import {
  createTextDeltaCoalescer,
  textDeltaFromPiEvent,
} from "@/lib/agent/sessions/text-delta-coalescer";
import { isEmptyStarterSession } from "@/lib/agent/sessions/store";
import {
  beginSessionSubmit,
  endSessionSubmit,
} from "@/lib/agent/sessions/submit-guard";
import type { Session } from "@/lib/agent/sessions/types";
import { runtimeContextUsage } from "@/lib/agent/sessions/api";
import {
  acceptRuntimeSeq,
  adoptExternalCursor,
  shouldSubscribeRuntimeEvents,
} from "@/lib/agent/sessions/runtime-cursor";
import { ACTIVE_AGENT_SESSION_OPEN_EVENT } from "@/lib/agent/workspace/events";
import { subscribeWorkspaceWindowEvents } from "@/lib/agent/workspace/effects";
import { reducer } from "@/lib/agent/workspace/reducer";
import type {
  WorkspaceAction,
  WorkspaceState,
} from "@/lib/agent/workspace/types";
import { collectLeaves } from "@/lib/agent/workspace/layout";
import { groupAssistantBlocks } from "@/app/agent/_components/timeline/session-pane-block-router";
import { resolveStatusSectionView } from "@/components/dashboard/control-panel/status-section-view";
import { parseArgsText } from "@/ui/plugins/plugins-utils";

declare global {
  var __VLLM_STUDIO_BROWSER_READER_HOST_RESOLVER_FOR_TEST:
    | ((
        hostname: string,
      ) => Promise<(string | { address: string; family: 4 | 6 })[]>)
    | undefined;
  var __VLLM_STUDIO_BROWSER_READER_REQUEST_FOR_TEST:
    | ((
        url: string,
        address: { address: string; family: 4 | 6 },
      ) => Promise<{
        status: number;
        ok: boolean;
        url: string;
        contentType: string;
        body: string;
        location?: string;
      }>)
    | undefined;
}

function makeSession(id: string, patch: Partial<Session> = {}): Session {
  return {
    id,
    runtimeSessionId: `rt-${id}`,
    piSessionId: null,
    title: "New session",
    messages: [],
    status: "idle",
    error: "",
    input: "",
    ...patch,
  };
}

function makeState(session = makeSession("s-main")): WorkspaceState {
  return {
    sessions: new Map([[session.id, session]]),
    models: [],
    selectedModel: "",
    modelsLoading: false,
    layout: { kind: "leaf", paneId: "p-main" },
    panesById: new Map([
      ["p-main", { sessionId: session.id }],
    ]),
    focusedPaneId: "p-main",
    setupWarning: "",
    error: "",
    hydrated: true,
    lastHandledNavKey: "",
  };
}

function makeWorkspaceWindowHarness() {
  const listeners = new Map<string, Set<(event: Event) => void>>();
  class HarnessCustomEvent<T> extends Event {
    detail: T;
    constructor(type: string, init: { detail: T }) {
      super(type);
      this.detail = init.detail;
    }
  }
  return {
    window: {
      Event,
      CustomEvent: HarnessCustomEvent as typeof CustomEvent,
      dispatchEvent: (event: Event) => {
        for (const listener of listeners.get(event.type) ?? []) listener(event);
        return true;
      },
      addEventListener: (
        type: string,
        listener: EventListenerOrEventListenerObject,
      ) => {
        const set = listeners.get(type) ?? new Set<(event: Event) => void>();
        set.add(
          typeof listener === "function"
            ? listener
            : (event: Event) => listener.handleEvent(event),
        );
        listeners.set(type, set);
      },
      removeEventListener: (
        type: string,
        listener: EventListenerOrEventListenerObject,
      ) => {
        const set = listeners.get(type);
        if (!set) return;
        set.delete(
          typeof listener === "function"
            ? listener
            : (event: Event) => listener.handleEvent(event),
        );
      },
    },
  };
}

test("browser navigate primes the URL while the browser surface is mounting", async () => {
  let browserUrl = "";
  let browserInput = "";

  const result = await runBrowserPanelCommand(
    "navigate",
    { url: "https://example.com/docs" },
    {
      browser: null,
      currentUrl: "",
      isElectron: true,
      setBrowserUrl: (url, input) => {
        browserUrl = url;
        browserInput = input ?? "";
      },
    },
  );

  assert.equal(result.ok, true);
  assert.equal(browserUrl, "https://example.com/docs");
  assert.equal(browserInput, "https://example.com/docs");
  assert.equal((result.data as { pending?: boolean }).pending, true);
});

test("free-text browser searches avoid Google webview refresh loops", () => {
  assert.equal(
    normalizeBrowserInput("latest vllm docs", "/workspace/project"),
    "https://duckduckgo.com/?q=latest%20vllm%20docs",
  );
});

test("status metrics fall back to stored peaks when current session peaks are absent", () => {
  const view = resolveStatusSectionView({
    currentProcess: {
      pid: 123,
      backend: "vllm",
      model_path: "/models/nemotron-3-ultra",
      served_model_name: "nemotron-3-ultra",
      port: 8000,
    },
    currentRecipe: null,
    gpus: [],
    metrics: {
      generation_throughput: 0,
      prompt_throughput: 0,
      avg_ttft_ms: 102_704.8,
      best_session_generation_tps: 137.4226,
      best_session_prefill_tps: 62_245.2748,
      best_session_ttft_ms: 931.115,
      peak_generation_tps: 137.4226,
      peak_prefill_tps: 62_245.2748,
      peak_ttft_ms: 78.58,
    },
  });

  assert.equal(view.metricColumns[0]?.value, "0.0");
  assert.equal(view.metricColumns[0]?.detail, "max 137.4");
  assert.equal(view.metricColumns[2]?.detail, "max 62245.3");
  assert.equal(view.metricColumns[1]?.detail, "best 931 ms");
  assert.match(
    view.metricColumns[1]?.detailTitle ?? "",
    /all-time best: 79 ms/,
  );
  assert.equal(view.sampleInput.generationPeak, 137.4226);
  assert.equal(view.sampleInput.prefillPeak, 62_245.2748);
  assert.equal(view.sampleInput.ttftPeak, 931.115);
});

test("status runtime counters distinguish app totals from engine counters", () => {
  const view = resolveStatusSectionView({
    currentProcess: null,
    currentRecipe: null,
    gpus: [],
    metrics: {
      total_tokens: 27_630_773,
      prompt_tokens_total: 268,
      generation_tokens_total: 2_590,
      latency_avg: 32_686,
    },
  });

  assert.deepEqual(
    view.runtimeMetrics.map((metric) => metric.label),
    ["app tokens", "engine prompt", "engine decode", "avg latency"],
  );
  assert.match(view.runtimeMetrics[0]?.title ?? "", /request log/);
  assert.match(view.runtimeMetrics[1]?.title ?? "", /inference engine/);
  assert.equal(view.runtimeMetrics[0]?.value, "27,630,773");
  assert.equal(view.runtimeMetrics[1]?.value, "268");
  assert.equal(view.runtimeMetrics[2]?.value, "2,590");
  assert.equal(view.runtimeMetrics[3]?.value, "32.69s");
});

test("runtime null context usage clears stale compaction warnings", () => {
  const stale = {
    tokens: 999_999,
    contextWindow: 1_000_000,
    percent: 99.9,
    shouldCompact: true,
  };

  assert.equal(runtimeContextUsage({ contextUsage: null }, stale), null);
});

test("turn command result parser preserves runtime status", () => {
  const payload = parseAgentTurnCommandResult({
    type: "command",
    outcome: "accepted",
    runtimeSessionId: "rt-1",
    piSessionId: "pi-1",
    active: true,
    status: {
      active: true,
      piSessionId: "pi-1",
      contextUsage: null,
    },
  });

  assert.equal(payload?.outcome, "accepted");
  assert.equal(payload?.runtimeSessionId, "rt-1");
  assert.equal(payload?.status?.active, true);
  assert.equal(payload?.status?.contextUsage, null);
});

test("successful compaction suppresses stale runtime compaction warnings until fresh usage", () => {
  const usage = { tokens: 190_000, contextWindow: 200_000, percent: 95 };
  const compactionEvent = {
    type: "compaction_end",
    result: {
      summary: "Compacted",
      firstKeptEntryId: "m2",
      tokensBefore: 190_000,
    },
    aborted: false,
  };

  assert.equal(piEventIsSuccessfulCompaction(compactionEvent), true);
  assert.deepEqual(contextUsageAwaitingFreshCompactionUsage(usage), {
    tokens: null,
    contextWindow: 200_000,
    percent: null,
    shouldCompact: false,
  });
});

test("post-compaction usage stays suppressed when the next prompt reports stale high usage", () => {
  const compactionEvent = {
    type: "compaction_end",
    result: {
      summary: "Compacted",
      firstKeptEntryId: "m2",
      tokensBefore: 190_000,
    },
    aborted: false,
  };
  const staleUsage = {
    tokens: 190_000,
    contextWindow: 200_000,
    percent: 95,
    shouldCompact: true,
  };
  const freshUsage = {
    tokens: 42_000,
    contextWindow: 200_000,
    percent: 21,
    shouldCompact: false,
  };
  const freshButStillCompactableUsage = {
    tokens: 185_000,
    contextWindow: 200_000,
    percent: 92.5,
    shouldCompact: true,
  };

  assert.equal(compactionTokensBefore(compactionEvent), 190_000);
  assert.equal(postCompactionUsageIsFresh(staleUsage, 190_000), false);
  assert.equal(postCompactionUsageIsFresh(freshUsage, 190_000), true);
  assert.equal(
    postCompactionUsageIsFresh(freshButStillCompactableUsage, 190_000),
    true,
  );
});

test("post-compaction prompt guard normalizes replayed assistant timestamps", () => {
  const branch = [
    {
      type: "message",
      timestamp: "2026-06-06T17:00:00.000Z" as string | number,
    },
    {
      type: "compaction",
      timestamp: "2026-06-06T17:02:00.000Z" as string | number,
    },
  ];
  const sdkSession = {
    messages: [
      { role: "assistant", timestamp: "2026-06-06T17:00:00.000Z" },
      { role: "user", timestamp: "2026-06-06T17:01:00.000Z" },
      { role: "assistant" },
    ],
    sessionManager: {
      getBranch: () => branch,
    },
  };

  assert.equal(
    normalizeSdkMessageTimestampsForCompactionBoundary(sdkSession),
    true,
  );
  assert.equal(
    sdkSession.messages[0]?.timestamp,
    Date.parse("2026-06-06T17:00:00.000Z"),
  );
  assert.equal(
    sdkSession.messages[2]?.timestamp,
    Date.parse("2026-06-06T17:02:00.000Z") - 1,
  );
  assert.equal(branch[1]?.timestamp, Date.parse("2026-06-06T17:02:00.000Z"));
});

test("post-compaction prompt guard normalizes resumed Pi agent state messages", () => {
  const branch = [
    {
      type: "message",
      timestamp: "2026-06-06T17:00:00.000Z" as string | number,
    },
    {
      type: "compaction",
      timestamp: "2026-06-06T17:02:00.000Z" as string | number,
    },
  ];
  const sdkSession = {
    agent: {
      state: {
        messages: [
          { role: "assistant", timestamp: "2026-06-06T17:00:00.000Z" },
          { role: "assistant", timestamp: "2026-06-06T17:01:00.000Z" },
        ],
      },
    },
    sessionManager: {
      getBranch: () => branch,
    },
  };

  assert.equal(
    normalizeSdkMessageTimestampsForCompactionBoundary(sdkSession),
    true,
  );
  assert.equal(
    sdkSession.agent.state.messages[0]?.timestamp,
    Date.parse("2026-06-06T17:00:00.000Z"),
  );
  assert.equal(
    sdkSession.agent.state.messages[1]?.timestamp,
    Date.parse("2026-06-06T17:01:00.000Z"),
  );
});

test("post-compaction prompt guard stamps missing pre-boundary assistant timestamps only", () => {
  const compactionMs = Date.parse("2026-06-06T17:02:00.000Z");
  const branch = [
    {
      type: "message",
      timestamp: "2026-06-06T17:00:00.000Z" as string | number,
    },
    {
      type: "compaction",
      timestamp: "2026-06-06T17:02:00.000Z" as string | number,
    },
  ];
  const sdkSession = {
    agent: {
      state: {
        messages: [
          { role: "compactionSummary", timestamp: compactionMs },
          {
            role: "assistant",
            usage: { inputTokens: 180_000, outputTokens: 1_000 },
          },
          { role: "user", timestamp: compactionMs + 10_000 },
          { role: "assistant", timestamp: "2026-06-06T17:03:00.000Z" },
        ],
      },
    },
    sessionManager: {
      getBranch: () => branch,
    },
  };

  assert.equal(
    normalizeSdkMessageTimestampsForCompactionBoundary(sdkSession),
    true,
  );
  assert.equal(sdkSession.agent.state.messages[1]?.timestamp, compactionMs - 1);
  assert.equal(
    sdkSession.agent.state.messages[3]?.timestamp,
    compactionMs + 60_000,
  );
});

test("post-compaction prompt guard copies kept assistant timestamps from branch entries", () => {
  const compactionMs = Date.parse("2026-06-06T17:02:00.000Z");
  const keptAssistant: {
    role: string;
    content: Array<{ type: string; text: string }>;
    usage: { inputTokens: number; outputTokens: number };
    timestamp?: number;
  } = {
    role: "assistant",
    content: [{ type: "text", text: "pre-compaction answer" }],
    usage: { inputTokens: 180_000, outputTokens: 1_000 },
  };
  const sdkSession = {
    agent: {
      state: {
        messages: [
          { role: "compactionSummary", timestamp: compactionMs },
          keptAssistant,
        ],
      },
    },
    sessionManager: {
      getBranch: () => [
        {
          type: "message",
          timestamp: "2026-06-06T17:00:00.000Z" as string | number,
          message: keptAssistant,
        },
        {
          type: "compaction",
          timestamp: "2026-06-06T17:02:00.000Z" as string | number,
        },
      ],
    },
  };

  assert.equal(
    normalizeSdkMessageTimestampsForCompactionBoundary(sdkSession),
    true,
  );
  assert.equal(keptAssistant.timestamp, Date.parse("2026-06-06T17:00:00.000Z"));
});

test("post-compaction prompt guard matches cloned kept messages by content", () => {
  const compactionMs = Date.parse("2026-06-06T17:02:00.000Z");
  const keptContent = [{ type: "text", text: "pre-compaction answer" }];
  const clonedAssistant: {
    role: string;
    content: Array<{ type: string; text: string }>;
    stopReason: string;
    usage: { inputTokens: number; outputTokens: number };
    timestamp?: number;
  } = {
    role: "assistant",
    content: keptContent,
    stopReason: "stop",
    usage: { inputTokens: 180_000, outputTokens: 1_000 },
  };
  const sdkSession = {
    state: {
      messages: [
        { role: "compactionSummary", timestamp: compactionMs },
        clonedAssistant,
      ],
    },
    sessionManager: {
      getBranch: () => [
        {
          type: "message",
          timestamp: "2026-06-06T17:00:00.000Z" as string | number,
          message: {
            role: "assistant",
            content: keptContent,
            stopReason: "stop",
          },
        },
        {
          type: "compaction",
          timestamp: "2026-06-06T17:02:00.000Z" as string | number,
        },
      ],
    },
  };

  assert.equal(
    normalizeSdkMessageTimestampsForCompactionBoundary(sdkSession),
    true,
  );
  assert.equal(
    clonedAssistant.timestamp,
    Date.parse("2026-06-06T17:00:00.000Z"),
  );
});

test("post-compaction prompt guard preserves duplicate cloned assistant order", () => {
  const compactionMs = Date.parse("2026-06-06T17:02:00.000Z");
  const repeatedContent = [{ type: "text", text: "Done" }];
  const preCompactionClone: {
    role: string;
    content: Array<{ type: string; text: string }>;
    stopReason: string;
    usage: { inputTokens: number; outputTokens: number };
    timestamp?: number;
  } = {
    role: "assistant",
    content: repeatedContent,
    stopReason: "stop",
    usage: { inputTokens: 180_000, outputTokens: 1_000 },
  };
  const postCompactionClone: typeof preCompactionClone = {
    role: "assistant",
    content: repeatedContent,
    stopReason: "stop",
    usage: { inputTokens: 10_000, outputTokens: 100 },
  };
  const sdkSession = {
    state: {
      messages: [
        { role: "compactionSummary", timestamp: compactionMs },
        preCompactionClone,
        { role: "user", timestamp: compactionMs + 10_000 },
        postCompactionClone,
      ],
    },
    sessionManager: {
      getBranch: () => [
        {
          type: "message",
          timestamp: "2026-06-06T17:00:00.000Z" as string | number,
          message: {
            role: "assistant",
            content: repeatedContent,
            stopReason: "stop",
          },
        },
        {
          type: "compaction",
          timestamp: "2026-06-06T17:02:00.000Z" as string | number,
        },
        {
          type: "message",
          timestamp: "2026-06-06T17:03:00.000Z" as string | number,
          message: {
            role: "assistant",
            content: repeatedContent,
            stopReason: "stop",
          },
        },
      ],
    },
  };

  assert.equal(
    normalizeSdkMessageTimestampsForCompactionBoundary(sdkSession),
    true,
  );
  assert.equal(
    preCompactionClone.timestamp,
    Date.parse("2026-06-06T17:00:00.000Z"),
  );
  assert.equal(
    postCompactionClone.timestamp,
    Date.parse("2026-06-06T17:03:00.000Z"),
  );
});

test("post-compaction prompt decision skips stale kept assistant usage", () => {
  const compactionMs = Date.parse("2026-06-06T17:02:00.000Z");
  const keptAssistant: {
    role: string;
    content: Array<{ type: string; text: string }>;
    stopReason: string;
    usage: { inputTokens: number; outputTokens: number };
    timestamp?: number;
  } = {
    role: "assistant",
    content: [{ type: "text", text: "large pre-compaction answer" }],
    stopReason: "stop",
    usage: { inputTokens: 180_000, outputTokens: 10_000 },
  };
  const compactionEvent = {
    type: "compaction_end",
    result: {
      summary: "Compacted",
      firstKeptEntryId: "kept",
      tokensBefore: 190_000,
    },
  };
  const branch = [
    {
      type: "message",
      id: "kept",
      timestamp: "2026-06-06T17:00:00.000Z" as string | number,
      message: {
        role: "assistant",
        content: keptAssistant.content,
        stopReason: "stop",
      },
    },
    {
      type: "compaction",
      timestamp: "2026-06-06T17:02:00.000Z" as string | number,
    },
  ];
  const sdkSession = {
    state: {
      messages: [
        { role: "compactionSummary", timestamp: compactionMs },
        keptAssistant,
      ],
    },
    sessionManager: {
      getBranch: () => branch,
    },
  };
  const staleHighUsage = {
    tokens: 190_000,
    contextWindow: 200_000,
    percent: 95,
    shouldCompact: true,
  };

  assert.equal(
    normalizeSdkMessageTimestampsForCompactionBoundary(sdkSession),
    true,
  );
  assert.equal(keptAssistant.timestamp, Date.parse("2026-06-06T17:00:00.000Z"));
  assert.equal(
    keptAssistant.timestamp <= compactionMs,
    true,
    "SDK pre-prompt compaction check should treat kept assistant usage as pre-boundary",
  );
  assert.equal(
    postCompactionUsageIsFresh(
      staleHighUsage,
      compactionTokensBefore(compactionEvent),
    ),
    false,
    "runtime status should keep stale high usage suppressed until fresh assistant usage arrives",
  );
});

test("post-compaction prompt guard accepts compaction-like boundary entry types", () => {
  const compactionMs = Date.parse("2026-06-06T17:02:00.000Z");
  const branch = [
    {
      type: "message",
      timestamp: "2026-06-06T17:00:00.000Z" as string | number,
    },
    {
      type: "context_compaction",
      timestamp: "2026-06-06T17:02:00.000Z" as string | number,
    },
  ];
  const sdkSession = {
    messages: [
      {
        role: "assistant",
        usage: { inputTokens: 180_000, outputTokens: 1_000 },
      },
    ],
    sessionManager: {
      getBranch: () => branch,
    },
  };

  assert.equal(
    normalizeSdkMessageTimestampsForCompactionBoundary(sdkSession),
    true,
  );
  assert.equal(sdkSession.messages[0]?.timestamp, compactionMs - 1);
});

test("failed compaction events do not acknowledge the compaction boundary", () => {
  assert.equal(
    piEventIsSuccessfulCompaction({
      type: "compaction_end",
      result: null,
      errorMessage: "Auto-compaction failed",
    }),
    false,
  );
});

test("desktop browser reader fetch renders public markdown and rejects private urls", async () => {
  const previousDataDir = process.env.VLLM_STUDIO_DATA_DIR;
  let requestCount = 0;
  const connectedAddresses: string[] = [];
  process.env.VLLM_STUDIO_DATA_DIR = "/tmp/vllm-studio-desktop-test";
  globalThis.__VLLM_STUDIO_BROWSER_READER_HOST_RESOLVER_FOR_TEST = async (
    hostname,
  ) =>
    hostname === "private-dns.test"
      ? ["127.0.0.1"]
      : hostname === "mapped-private.test"
        ? ["::ffff:127.0.0.1"]
        : ["93.184.216.34"];
  globalThis.__VLLM_STUDIO_BROWSER_READER_REQUEST_FOR_TEST = async (
    url,
    address,
  ) => {
    requestCount += 1;
    connectedAddresses.push(address.address);
    if (url.includes("redirect.test")) {
      return {
        status: 302,
        ok: false,
        url,
        contentType: "",
        body: "",
        location: "http://localhost:3000/private",
      };
    }
    if (url.includes("html.test")) {
      return {
        status: 200,
        ok: true,
        url,
        contentType: "text/html; charset=utf-8",
        body: "<html><head><title>HTML Works</title><script>bad()</script></head><body><h1>Hello</h1><p>World</p></body></html>",
      };
    }
    return {
      status: 200,
      ok: true,
      url,
      contentType: "text/markdown; charset=utf-8",
      body: "# Reader Works\n\n[Docs](/docs)\n",
    };
  };
  try {
    const { GET } = await import("@/app/api/agent/browser/fetch/route");
    const response = await GET({
      nextUrl: new URL(
        "http://localhost/api/agent/browser/fetch?url=https%3A%2F%2Fexample.com%2F",
      ),
    } as never);
    const body = (await response.json()) as {
      markdown?: string;
      title?: string;
    };
    assert.equal(response.status, 200);
    assert.equal(body.title, "Reader Works");
    assert.match(body.markdown ?? "", /Reader Works/);

    const htmlResponse = await GET({
      nextUrl: new URL(
        "http://localhost/api/agent/browser/fetch?url=https%3A%2F%2Fhtml.test%2F",
      ),
    } as never);
    const htmlBody = (await htmlResponse.json()) as {
      text?: string;
      title?: string;
    };
    assert.equal(htmlResponse.status, 200);
    assert.equal(htmlBody.title, "HTML Works");
    assert.match(htmlBody.text ?? "", /Hello/);
    assert.doesNotMatch(htmlBody.text ?? "", /bad\(\)/);

    const rejected = await GET({
      nextUrl: new URL(
        "http://localhost/api/agent/browser/fetch?url=http%3A%2F%2Flocalhost%3A3000%2F",
      ),
    } as never);
    const rejectedBody = (await rejected.json()) as { error?: string };
    assert.equal(rejected.status, 400);
    assert.match(rejectedBody.error ?? "", /public http\/https/);

    const redirectRejected = await GET({
      nextUrl: new URL(
        "http://localhost/api/agent/browser/fetch?url=https%3A%2F%2Fredirect.test%2F",
      ),
    } as never);
    const redirectBody = (await redirectRejected.json()) as { error?: string };
    assert.equal(redirectRejected.status, 502);
    assert.match(redirectBody.error ?? "", /Redirect rejected/);

    const dnsRejected = await GET({
      nextUrl: new URL(
        "http://localhost/api/agent/browser/fetch?url=https%3A%2F%2Fprivate-dns.test%2F",
      ),
    } as never);
    const dnsBody = (await dnsRejected.json()) as { error?: string };
    assert.equal(dnsRejected.status, 502);
    assert.match(dnsBody.error ?? "", /Resolved host rejected/);

    const mappedDnsRejected = await GET({
      nextUrl: new URL(
        "http://localhost/api/agent/browser/fetch?url=https%3A%2F%2Fmapped-private.test%2F",
      ),
    } as never);
    const mappedDnsBody = (await mappedDnsRejected.json()) as {
      error?: string;
    };
    assert.equal(mappedDnsRejected.status, 502);
    assert.match(mappedDnsBody.error ?? "", /Resolved host rejected/);
    assert.equal(requestCount, 3);
    assert.deepEqual(connectedAddresses, [
      "93.184.216.34",
      "93.184.216.34",
      "93.184.216.34",
    ]);
  } finally {
    delete globalThis.__VLLM_STUDIO_BROWSER_READER_HOST_RESOLVER_FOR_TEST;
    delete globalThis.__VLLM_STUDIO_BROWSER_READER_REQUEST_FOR_TEST;
    if (previousDataDir === undefined) delete process.env.VLLM_STUDIO_DATA_DIR;
    else process.env.VLLM_STUDIO_DATA_DIR = previousDataDir;
  }
});

test("curated local MCP servers require explicit target args", async () => {
  const { handleMcpAction } = await import("@/lib/agent/mcp/api");
  const missing = handleMcpAction({
    action: "add_from_catalogue",
    catalogueId: "catalogue:filesystem",
    args: ["-y", "@modelcontextprotocol/server-filesystem"],
  });

  assert.equal(missing.status, 400);
  assert.match(String(missing.payload.error), /requires a local path/);

  const flagOnly = handleMcpAction({
    action: "add_from_catalogue",
    catalogueId: "catalogue:git",
    args: ["-y", "@modelcontextprotocol/server-git", "--readonly"],
  });

  assert.equal(flagOnly.status, 400);
  assert.match(String(flagOnly.payload.error), /requires a local path/);

  const replacedPackage = handleMcpAction({
    action: "add_from_catalogue",
    catalogueId: "catalogue:filesystem",
    args: ["-y", "malicious-package", "/tmp"],
  });

  assert.equal(replacedPackage.status, 400);
  assert.match(String(replacedPackage.payload.error), /reviewed prefix/);

  const urlTarget = handleMcpAction({
    action: "add_from_catalogue",
    catalogueId: "catalogue:filesystem",
    args: [
      "-y",
      "@modelcontextprotocol/server-filesystem",
      "https://evil.example",
    ],
  });

  assert.equal(urlTarget.status, 400);
  assert.match(String(urlTarget.payload.error), /requires a local path/);

  const mixedUrlTarget = handleMcpAction({
    action: "add_from_catalogue",
    catalogueId: "catalogue:filesystem",
    args: [
      "-y",
      "@modelcontextprotocol/server-filesystem",
      "/tmp",
      "https://evil.example",
    ],
  });

  assert.equal(mixedUrlTarget.status, 400);
  assert.match(String(mixedUrlTarget.payload.error), /requires a local path/);

  const mixedPlainTarget = handleMcpAction({
    action: "add_from_catalogue",
    catalogueId: "catalogue:filesystem",
    args: ["-y", "@modelcontextprotocol/server-filesystem", "/tmp", "docs"],
  });

  assert.equal(mixedPlainTarget.status, 400);
  assert.match(String(mixedPlainTarget.payload.error), /requires a local path/);
  assert.deepEqual(
    parseArgsText(
      '-y @modelcontextprotocol/server-filesystem "/Users/sero/My Project"',
    ),
    ["-y", "@modelcontextprotocol/server-filesystem", "/Users/sero/My Project"],
  );
});

function makePiEventApplierHarness(
  initialSession: Session,
  assistantId = "a-main",
): {
  apply: (sessionId: string, assistantId: string, event: Record<string, unknown>) => void;
  session: () => Session;
} {
  let session = initialSession;
  const ctx: SessionStreamContext = {
    liveAssistantIds: new Map([[initialSession.id, assistantId]]),
  };
  const apply = (sessionId: string, targetAssistantId: string, event: Record<string, unknown>) => {
    if (sessionId !== session.id) return;
    session = reduceSessionEvent(session, ctx, targetAssistantId, event);
  };
  return { apply, session: () => session };
}

test("new chat url navigation replaces the focused chat with a fresh runtime", () => {
  const oldSession = makeSession("s-old", {
    runtimeSessionId: "rt-old",
    piSessionId: "pi-old",
    title: "Old debugging chat",
    status: "running",
    startedAt: "2026-05-28T12:00:00.000Z",
    activeAssistantId: "a-old",
    lastEventSeq: 12,
    input: "draft stuck on old chat",
  });
  const freshSession = makeSession("s-fresh", {
    runtimeSessionId: "rt-fresh",
    title: "New session",
  });
  const state: WorkspaceState = {
    ...makeState(oldSession),
    selectedModel: "model-a",
  };

  const next = reducer(state, {
    type: "urlNavRequested",
    key: "project-a||1|",
    project: null,
    newSession: true,
    paneId: "p-url-new",
    tab: freshSession,
  });

  const pane = next.panesById.get("p-main");
  assert.equal(pane?.sessionId, "s-fresh");
  assert.equal(next.sessions.get("s-fresh")?.runtimeSessionId, "rt-fresh");
  assert.equal(next.sessions.has("s-old"), false);
  const active = next.sessions.get("s-fresh");
  assert.equal(active?.title, "New session");
  assert.equal(active?.piSessionId, null);
  assert.equal(active?.status, "idle");
  assert.equal(active?.input, "");
  assert.equal(active?.modelId, "model-a");
});

test("active local sidebar rows focus by pane and tab without cloning identity", () => {
  const actions: WorkspaceAction[] = [];
  const { window } = makeWorkspaceWindowHarness();
  const unsubscribe = subscribeWorkspaceWindowEvents(window, (action) =>
    actions.push(action),
  );

  window.dispatchEvent(
    new window.CustomEvent(ACTIVE_AGENT_SESSION_OPEN_EVENT, {
      detail: {
        paneId: "p-main",
        tabId: "s-local",
        projectId: "project-a",
        cwd: "/workspace/project-a",
        title: "Local chat",
        mode: "focus",
      },
    }),
  );
  unsubscribe();

  assert.equal(actions.length, 2);
  assert.equal(actions[0].type, "focusPaneSession");
  assert.equal(actions[0].paneId, "p-main");
  assert.equal(actions[0].sessionId, "s-local");
  assert.equal(actions[1].type, "workspaceUnmounted");
});

test("new chat replaces an empty starter with fresh identity", () => {
  const starter = makeSession("s-starter", {
    title: "Old chat title",
    status: "done",
    error: "old error",
    tokenStats: { read: 1, write: 2, current: 3 },
    contextUsage: {
      tokens: 3,
      contextWindow: 10,
      percent: 30,
      shouldCompact: false,
    },
    usedSkills: [{ id: "skill-old", name: "Old skill" }],
  });

  assert.equal(isEmptyStarterSession(starter), true);

  const next = reducer(makeState(starter), {
    type: "urlNavRequested",
    key: "nav-new-chat",
    project: null,
    newSession: true,
    paneId: "p-new",
    tab: makeSession("s-fresh"),
  });

  const active = next.sessions.get(
    next.panesById.get("p-main")?.sessionId ?? "",
  );
  assert.equal(active?.id, "s-fresh");
  assert.equal(active?.runtimeSessionId, "rt-s-fresh");
  assert.equal(next.sessions.has("s-starter"), false);
  assert.equal(active?.title, "New session");
  assert.equal(active?.status, "idle");
  assert.equal(active?.error, "");
  assert.equal(active?.tokenStats, undefined);
  assert.equal(active?.contextUsage, undefined);
  assert.equal(active?.usedSkills, undefined);
});

test("explicit new-session navigation blocks persisted active-session hydration", () => {
  const params = new URLSearchParams("project=personal&new=first-click");
  const oldSnapshot = {
    projectId: "personal",
    cwd: "/workspace/personal",
    paneId: "p-main",
    tabId: "tab-old",
    runtimeSessionId: "rt-old",
    piSessionId: "pi-old",
    title: "Old restored chat",
    status: "running" as const,
    focused: true,
  };

  assert.equal(hasExplicitSessionNavigation(params), true);

  const next = reducer(
    { ...makeState(), hydrated: false },
    {
      type: "hydrateActiveSessions",
      projects: [
        { id: "personal", name: "personal", path: "/workspace/personal" },
      ],
      snapshots: [oldSnapshot],
      hasExplicitSessionNav: hasExplicitSessionNavigation(params),
    },
  );

  const active = next.sessions.get(
    next.panesById.get("p-main")?.sessionId ?? "",
  );
  assert.equal(active?.piSessionId, null);
  assert.notEqual(active?.id, "tab-old");
  assert.equal(next.hydrated, true);
});

test("empty starter detection rejects cleared live sessions", () => {
  const clearedLive = makeSession("s-cleared-live", {
    status: "running",
    startedAt: "2026-05-28T12:00:00.000Z",
    activeAssistantId: "a-old",
    lastEventSeq: 9,
    queue: [{ id: "q-old", mode: "follow_up", text: "later", sent: true }],
  });

  assert.equal(isEmptyStarterSession(clearedLive), false);
});

test("session submit guards block duplicate sends only within the same session", () => {
  const guard = new Set<string>();

  assert.equal(beginSessionSubmit(guard, "s-old"), true);
  assert.equal(beginSessionSubmit(guard, "s-old"), false);
  assert.equal(beginSessionSubmit(guard, "s-new"), true);
  endSessionSubmit(guard, "s-old");
  assert.equal(beginSessionSubmit(guard, "s-old"), true);
});

test("agent session navigation restores running SDK sessions with runtime identity", () => {
  const state = { ...makeState(), hydrated: false };
  const usedSkills = [
    { id: "skill-browser", name: "browser", path: "/skills/browser" },
  ];

  const next = reducer(state, {
    type: "hydrateActiveSessions",
    projects: [
      { id: "personal", name: "personal", path: "/workspace/personal" },
    ],
    snapshots: [
      {
        projectId: "personal",
        cwd: "/workspace/personal",
        paneId: "p-main",
        tabId: "tab-deepseek",
        runtimeSessionId: "rt-deepseek",
        piSessionId: "pi-deepseek",
        modelId: "deepseek-v4-flash",
        title: "Still running",
        status: "running",
        focused: true,
        updatedAt: "2026-05-26T12:00:00.000Z",
        usedSkills,
      },
    ],
  });

  const restoredPane = next.panesById.get("p-main");
  assert.equal(next.hydrated, true);
  assert.equal(next.focusedPaneId, "p-main");
  assert.equal(restoredPane?.sessionId, "tab-deepseek");
  const restored = next.sessions.get("tab-deepseek");
  assert.equal(restored?.runtimeSessionId, "rt-deepseek");
  assert.equal(restored?.piSessionId, "pi-deepseek");
  assert.equal(restored?.modelId, "deepseek-v4-flash");
  assert.deepEqual(restored?.usedSkills, usedSkills);
});

test("unprojected active sessions hydrate with their cwd", () => {
  const state = { ...makeState(), hydrated: false };

  const next = reducer(state, {
    type: "hydrateActiveSessions",
    projects: [],
    snapshots: [
      {
        projectId: "",
        cwd: "/Users/sero/.vllm-studio",
        paneId: "p-main",
        tabId: "tab-default",
        runtimeSessionId: "rt-default",
        piSessionId: "pi-default",
        modelId: "nemotron-3-ultra",
        title: "Default chat",
        status: "idle",
        focused: true,
        updatedAt: "2026-06-08T04:00:00.000Z",
      },
    ],
  });

  const active = next.sessions.get(
    next.panesById.get("p-main")?.sessionId ?? "",
  );
  assert.equal(active?.piSessionId, "pi-default");
  assert.equal(active?.cwd, "/Users/sero/.vllm-studio");
  assert.equal(active?.modelId, "nemotron-3-ultra");
});

test("session replay into a starter adopts cwd and model metadata", () => {
  const next = reducer(makeState(), {
    type: "urlNavRequested",
    key: "nav-replay",
    project: null,
    sessionId: "pi-replay",
    paneId: "p-replay",
    tab: makeSession("tab-replay", {
      runtimeSessionId: "rt-replay",
      cwd: "/Users/sero/.vllm-studio",
      modelId: "nemotron-3-ultra",
      title: "Persisted replay",
      startedAt: "2026-06-08T04:00:00.000Z",
    }),
  });

  const active = next.sessions.get(
    next.panesById.get("p-main")?.sessionId ?? "",
  );
  assert.equal(active?.piSessionId, "pi-replay");
  assert.equal(active?.cwd, "/Users/sero/.vllm-studio");
  assert.equal(active?.modelId, "nemotron-3-ultra");
  assert.equal(active?.startedAt, "2026-06-08T04:00:00.000Z");
});

test("agent session merge upgrades tab identity to pi identity without dropping focus", () => {
  const previous: ActiveAgentSessionSnapshot[] = [
    {
      projectId: "personal",
      cwd: "/workspace/personal",
      paneId: "p-main",
      tabId: "tab-1",
      runtimeSessionId: "rt-live",
      piSessionId: null,
      title: "Draft",
      status: "starting",
      focused: true,
      updatedAt: "2026-05-26T12:00:00.000Z",
    },
  ];

  const incoming: ActiveAgentSessionSnapshot[] = [
    {
      projectId: "personal",
      cwd: "/workspace/personal",
      paneId: "p-main",
      tabId: "tab-1",
      runtimeSessionId: "rt-live",
      piSessionId: "pi-live",
      modelId: "deepseek-v4-flash",
      title: "Live",
      status: "running",
      updatedAt: "2026-05-26T12:00:01.000Z",
      usedSkills: [{ id: "skill-code", name: "code" }],
    },
  ];

  const merged = mergeActiveAgentSessions(previous, incoming);

  assert.equal(merged.length, 1);
  assert.equal(merged[0]?.piSessionId, "pi-live");
  assert.equal(merged[0]?.focused, true);
  assert.equal(merged[0]?.runtimeSessionId, "rt-live");
  assert.equal(merged[0]?.modelId, "deepseek-v4-flash");
  assert.deepEqual(merged[0]?.usedSkills, [{ id: "skill-code", name: "code" }]);
});

test("agent session merge preserves multiple running sessions instead of normalizing to one active row", () => {
  const incoming: ActiveAgentSessionSnapshot[] = [
    {
      projectId: "personal",
      cwd: "/workspace/personal",
      paneId: "p-main",
      tabId: "tab-live",
      runtimeSessionId: "rt-live",
      piSessionId: "pi-live",
      title: "Live",
      status: "running",
      focused: true,
      updatedAt: "2026-05-26T12:00:02.000Z",
    },
    {
      projectId: "personal",
      cwd: "/workspace/personal",
      paneId: "p-side",
      tabId: "tab-side",
      runtimeSessionId: "rt-side",
      piSessionId: "pi-side",
      modelId: "deepseek-v4-flash",
      title: "Side live",
      status: "running",
      updatedAt: "2026-05-26T12:00:03.000Z",
    },
  ];

  const merged = mergeActiveAgentSessions([], incoming);

  assert.equal(merged.length, 2);
  assert.deepEqual(
    merged
      .map((session) => [session.piSessionId, session.status])
      .sort((a, b) => String(a[0]).localeCompare(String(b[0]))),
    [
      ["pi-live", "running"],
      ["pi-side", "running"],
    ],
  );
  assert.equal(
    merged.find((session) => session.piSessionId === "pi-live")?.focused,
    true,
  );
  assert.equal(
    merged.find((session) => session.piSessionId === "pi-side")?.modelId,
    "deepseek-v4-flash",
  );
});

test("agent session merge clears stale focused rows when another session is focused", () => {
  const previous: ActiveAgentSessionSnapshot[] = [
    {
      projectId: "personal",
      cwd: "/workspace/personal",
      paneId: "p-old",
      tabId: "tab-old",
      runtimeSessionId: "rt-old",
      piSessionId: "pi-old",
      title: "Old focused",
      status: "idle",
      focused: true,
      updatedAt: "2026-05-26T12:00:01.000Z",
    },
  ];

  const incoming: ActiveAgentSessionSnapshot[] = [
    {
      projectId: "personal",
      cwd: "/workspace/personal",
      paneId: "p-new",
      tabId: "tab-new",
      runtimeSessionId: "rt-new",
      piSessionId: "pi-new",
      title: "New focused",
      status: "running",
      focused: true,
      updatedAt: "2026-05-26T12:00:02.000Z",
    },
  ];

  const merged = mergeActiveAgentSessions(previous, incoming);

  assert.equal(
    merged.find((session) => session.piSessionId === "pi-new")?.focused,
    true,
  );
  assert.equal(
    merged.find((session) => session.piSessionId === "pi-old")?.focused,
    false,
  );
  assert.equal(merged.filter((session) => session.focused === true).length, 1);
});

test("completed runtime remains running but not active after the prompt promise settles", () => {
  const status = piStatusFromEvents({
    running: true,
    activePromptCount: 0,
    modelId: "deepseek-v4-flash",
    cwd: "/workspace",
    piSessionId: "pi-done",
    agentDir: "/tmp/pi",
    eventSeq: 3,
    lastError: null,
    eventLog: [
      {
        seq: 3,
        event: {
          type: "message_update",
          assistantMessageEvent: { type: "text_delta", delta: "done" },
        },
      },
    ],
  });

  assert.equal(status.running, true);
  assert.equal(status.active, false);
  assert.equal(runtimeStatusLooksActive(status), false);
});

test("runtime status stays active while a prompt is in flight", () => {
  const status = piStatusFromEvents({
    running: true,
    activePromptCount: 1,
    modelId: "deepseek-v4-flash",
    cwd: "/workspace",
    piSessionId: "pi-live",
    agentDir: "/tmp/pi",
    eventSeq: 2,
    lastError: null,
    eventLog: [
      {
        seq: 2,
        event: {
          type: "message_update",
          assistantMessageEvent: { type: "reasoning_delta", delta: "thinking" },
        },
      },
    ],
  });

  assert.equal(status.active, true);
  assert.equal(runtimeStatusLooksActive(status), true);
});

test("runtime status stays active while SDK is streaming after prompt handoff", () => {
  const status = piStatusFromEvents({
    running: true,
    activePromptCount: 0,
    sdkActive: true,
    modelId: "deepseek-v4-flash",
    cwd: "/workspace",
    piSessionId: "pi-live",
    agentDir: "/tmp/pi",
    eventSeq: 2,
    lastError: null,
    eventLog: [],
  });

  assert.equal(status.active, true);
  assert.equal(runtimeStatusLooksActive(status), true);
});

test("runtime lookup by unknown pi session does not create an empty runtime", () => {
  const sessions = [
    {
      sessionId: "rt-existing",
      session: { status: { piSessionId: "pi-existing" } },
    },
  ];
  const before = sessions.length;
  const resolved = findRuntimeSessionForLookup(
    sessions,
    "rt-missing-for-test",
    "pi-missing-for-test",
  );
  const after = sessions.length;

  assert.equal(resolved, null);
  assert.equal(after, before);
});

test("finished runtime event streams replay missed pi events before idle status", () => {
  assert.equal(initialRuntimeStatusPhase(false, 3), null);
  assert.equal(
    shouldSendTrailingIdleStatus({
      active: false,
      replayBacklogCount: 3,
      sentTerminalStatus: false,
    }),
    true,
  );
  assert.equal(initialRuntimeStatusPhase(false, 0), "idle");
  assert.equal(initialRuntimeStatusPhase(true, 3), "running");
  assert.equal(
    shouldSendTrailingIdleStatus({
      active: false,
      replayBacklogCount: 3,
      sentTerminalStatus: true,
    }),
    false,
  );
});

test("runtime event streams restart replay when SDK event sequence resets", () => {
  assert.equal(replayAfterCursor(42, 38), 0);
  assert.equal(replayAfterCursor(42, 42), 42);
  assert.equal(replayAfterCursor(0, 38), 0);
});

test("runtime event subscriptions wait for accepted running turns", () => {
  assert.equal(shouldSubscribeRuntimeEvents("starting"), false);
  assert.equal(shouldSubscribeRuntimeEvents("running"), true);
  assert.equal(shouldSubscribeRuntimeEvents("idle"), false);
});

test("runtime event cursor resets for a new prompt on the same Pi session", () => {
  const staleCursor = adoptExternalCursor(43);
  assert.equal(acceptRuntimeSeq(staleCursor, 28).accept, false);

  const resetCursor = adoptExternalCursor(0);
  const decision = acceptRuntimeSeq(resetCursor, 1);
  assert.equal(decision.accept, true);
  assert.equal(decision.cursor.receivedSeq, 1);
});

test("control routing uses active turn state, not runtime process existence", () => {
  assert.equal(
    controlTargetHasActiveTurn({ active: true, running: true }),
    true,
  );
  assert.equal(
    controlTargetHasActiveTurn({ active: false, running: true }),
    false,
  );
});

test("splitting a session is idempotent when navigating to an already open pi session", () => {
  const state = makeState(
    makeSession("s-main", {
      title: "Main",
      messages: [{ id: "u1", role: "user", text: "hi" }],
    }),
  );

  const split = reducer(state, {
    type: "splitPaneWithPayload",
    paneId: "p-main",
    direction: "vertical",
    side: "b",
    newPaneId: "p-side",
    payload: {
      projectId: "personal",
      cwd: "/workspace/personal",
      piSessionId: "pi-live",
      title: "Live session",
    },
    tab: makeSession("s-side", { title: "Live session" }),
  });

  assert.deepEqual(collectLeaves(split.layout), ["p-main", "p-side"]);
  assert.equal(split.focusedPaneId, "p-side");
  assert.equal(split.sessions.get("s-side")?.piSessionId, "pi-live");

  const navigatedAgain = reducer(split, {
    type: "splitPaneWithPayload",
    paneId: "p-main",
    direction: "vertical",
    side: "b",
    newPaneId: "p-third",
    payload: {
      projectId: "personal",
      cwd: "/workspace/personal",
      piSessionId: "pi-live",
      title: "Live session",
    },
    tab: makeSession("s-third"),
  });

  assert.deepEqual(collectLeaves(navigatedAgain.layout), ["p-main", "p-side"]);
  assert.equal(navigatedAgain.focusedPaneId, "p-side");
  assert.equal(navigatedAgain.panesById.has("p-third"), false);
});

test("forking a tab into a split pane copies session content with fresh identity", () => {
  const state = makeState(
    makeSession("s-main", {
      projectId: "personal",
      cwd: "/workspace/personal",
      modelId: "deepseek-v4-flash",
      piSessionId: "pi-source",
      title: "Source session",
      messages: [
        { id: "u1", role: "user", text: "build a thing" },
        { id: "a1", role: "assistant", text: "working" },
      ],
      queue: [{ id: "q1", mode: "follow_up", text: "continue" }],
      status: "running",
    }),
  );

  const forked = reducer(state, {
    type: "splitTab",
    sourcePaneId: "p-main",
    sourceTabId: "s-main",
    newPaneId: "p-fork",
    tab: makeSession("s-fork", { runtimeSessionId: "rt-fork-session" }),
  });

  assert.deepEqual(collectLeaves(forked.layout), ["p-main", "p-fork"]);
  assert.equal(forked.focusedPaneId, "p-fork");
  assert.equal(forked.panesById.get("p-main")?.sessionId, "s-main");
  assert.equal(forked.panesById.get("p-fork")?.sessionId, "s-fork");

  const source = forked.sessions.get("s-main");
  const copy = forked.sessions.get("s-fork");
  assert.equal(copy?.id, "s-fork");
  assert.equal(copy?.runtimeSessionId, "rt-fork-session");
  assert.equal(copy?.piSessionId, "pi-source");
  assert.equal(copy?.projectId, source?.projectId);
  assert.equal(copy?.cwd, source?.cwd);
  assert.equal(copy?.modelId, source?.modelId);
  assert.deepEqual(copy?.messages, source?.messages);
  assert.deepEqual(copy?.queue, source?.queue);
});

test("forking while already split replaces the sibling pane instead of adding a third", () => {
  const split = reducer(
    makeState(
      makeSession("s-main", {
        title: "Main",
        messages: [{ id: "u1", role: "user", text: "hi" }],
      }),
    ),
    {
      type: "splitTab",
      sourcePaneId: "p-main",
      sourceTabId: "s-main",
      newPaneId: "p-side",
      tab: makeSession("s-side", { runtimeSessionId: "rt-side-session" }),
    },
  );

  const forkedAgain = reducer(split, {
    type: "splitTab",
    sourcePaneId: "p-side",
    sourceTabId: "s-side",
    newPaneId: "p-third",
    runtimeSessionId: "rt-third-pane",
    tab: makeSession("s-third", { runtimeSessionId: "rt-third-session" }),
  });

  assert.deepEqual(collectLeaves(forkedAgain.layout), ["p-main", "p-side"]);
  assert.equal(forkedAgain.focusedPaneId, "p-main");
  assert.equal(forkedAgain.panesById.has("p-third"), false);
  assert.equal(forkedAgain.panesById.get("p-main")?.sessionId, "s-third");
  assert.equal(forkedAgain.sessions.has("s-main"), false);
  assert.equal(
    forkedAgain.sessions.get("s-third")?.runtimeSessionId,
    "rt-third-session",
  );
});

test("follow-up queue drains after agent end while steer messages stay out of the next turn", () => {
  // Pi drains its own follow_up queue server-side; the client reconciles the
  // visible queue: the drained head leaves, later unsent follow-ups stay, and
  // steer items never carry into the next turn.
  const { next, remaining } = drainQueueAfterAgentEnd([
    { id: "q-steer", mode: "steer", text: "adjust course" },
    { id: "q-next", mode: "follow_up", text: "next prompt" },
    { id: "q-after", mode: "follow_up", text: "after that" },
  ]);

  assert.equal(next?.text, "next prompt");
  assert.deepEqual(remaining, [
    { id: "q-after", mode: "follow_up", text: "after that" },
  ]);
});

test("compaction events render as assistant event blocks", () => {
  const blocks = applyAssistantPiEventToBlocks([], {
    type: "context_compaction",
    summary: "Compacted the current plan and selected skills.",
  });

  assert.equal(blocks.length, 1);
  assert.equal(blocks[0]?.kind, "event");
  assert.equal(
    blocks[0]?.text,
    "Compacted the current plan and selected skills.",
  );
});

test("compaction start and failed end events do not render completed compaction blocks", () => {
  assert.equal(
    applyAssistantPiEventToBlocks([], {
      type: "compaction_start",
      reason: "threshold",
    }),
    null,
  );
  assert.equal(
    applyAssistantPiEventToBlocks([], {
      type: "compaction_end",
      reason: "threshold",
      result: undefined,
      errorMessage: "Auto-compaction failed",
    }),
    null,
  );
});

test("successful compaction_end renders the completed result summary", () => {
  const blocks = applyAssistantPiEventToBlocks([], {
    type: "compaction_end",
    reason: "threshold",
    result: {
      summary: "Compacted before continuing.",
      firstKeptEntryId: "entry-1",
      tokensBefore: 180_000,
    },
  });

  assert.equal(blocks?.length, 1);
  assert.equal(blocks?.[0]?.kind, "event");
  assert.equal(blocks?.[0]?.text, "Compacted before continuing.");
});

test("compaction events clear stale token and context usage", () => {
  const { apply, session } = makePiEventApplierHarness(
    makeSession("s-compact", {
      tokenStats: { read: 1, write: 2, current: 3 },
      contextUsage: {
        tokens: 99_999,
        contextWindow: 100_000,
        percent: 99.9,
        shouldCompact: true,
      },
      messages: [{ id: "a-main", role: "assistant", text: "", blocks: [] }],
    }),
  );

  apply("s-compact", "a-main", {
    type: "compaction_end",
    reason: "threshold",
    result: {
      summary: "Compacted",
      firstKeptEntryId: "e1",
      tokensBefore: 99_999,
    },
  });

  assert.equal(session().tokenStats, undefined);
  assert.equal(session().contextUsage, null);
});

test("failed compaction events preserve stale token and context usage", () => {
  const contextUsage = {
    tokens: 99_999,
    contextWindow: 100_000,
    percent: 99.9,
    shouldCompact: true,
  };
  const tokenStats = { read: 1, write: 2, current: 3 };
  const { apply, session } = makePiEventApplierHarness(
    makeSession("s-compact-failed", {
      tokenStats,
      contextUsage,
      messages: [{ id: "a-main", role: "assistant", text: "", blocks: [] }],
    }),
  );

  apply("s-compact-failed", "a-main", {
    type: "compaction_end",
    status: "aborted",
    error: "Compaction was interrupted",
  });

  assert.deepEqual(session().tokenStats, tokenStats);
  assert.deepEqual(session().contextUsage, contextUsage);
});

test("failed compaction_end with errorMessage preserves stale token and context usage", () => {
  const contextUsage = {
    tokens: 99_999,
    contextWindow: 100_000,
    percent: 99.9,
    shouldCompact: true,
  };
  const tokenStats = { read: 1, write: 2, current: 3 };
  const { apply, session } = makePiEventApplierHarness(
    makeSession("s-compact-error-message", {
      tokenStats,
      contextUsage,
      messages: [{ id: "a-main", role: "assistant", text: "", blocks: [] }],
    }),
  );

  apply("s-compact-error-message", "a-main", {
    type: "compaction_end",
    errorMessage: "Compaction failed before producing a result",
    result: undefined,
  });

  assert.deepEqual(session().tokenStats, tokenStats);
  assert.deepEqual(session().contextUsage, contextUsage);
});

test("text deltas stay visible answer text when partial history already has reasoning", () => {
  const event = {
    type: "message_update",
    assistantMessageEvent: {
      type: "text_delta",
      delta: "Here is the final answer.",
      contentIndex: 1,
      partial: {
        role: "assistant",
        reasoning_content: "I should inspect this first.",
        content: [
          {
            type: "reasoning",
            reasoning_content: "I should inspect this first.",
          },
          {
            type: "text",
            text: "Here is the final answer.",
          },
        ],
      },
    },
  };

  const blocks = applyAssistantPiEventToBlocks([], event);
  assert.equal(blocks?.[0]?.kind, "text");
  assert.equal(blocks?.[0]?.text, "Here is the final answer.");
  assert.deepEqual(textDeltaFromPiEvent(event), {
    kind: "text",
    delta: "Here is the final answer.",
  });
});

test("text deltas always render as visible text regardless of partial reasoning shape", () => {
  const event = {
    type: "message_update",
    assistantMessageEvent: {
      type: "text_delta",
      delta: "I should inspect this first.",
      partial: {
        type: "reasoning",
        reasoning_content: "I should inspect this first.",
      },
    },
  };

  const blocks = applyAssistantPiEventToBlocks([], event);
  assert.equal(blocks?.[0]?.kind, "text");
  assert.equal(blocks?.[0]?.text, "I should inspect this first.");
  assert.deepEqual(textDeltaFromPiEvent(event), {
    kind: "text",
    delta: "I should inspect this first.",
  });
});

test("text deltas indexed to a reasoning content part still render as visible text", () => {
  const event = {
    type: "message_update",
    assistantMessageEvent: {
      type: "text_delta",
      delta: "I should inspect this first.",
      contentIndex: 0,
      partial: {
        role: "assistant",
        content: [
          {
            type: "reasoning",
            reasoning_content: "I should inspect this first.",
          },
        ],
      },
    },
  };

  const blocks = applyAssistantPiEventToBlocks([], event);
  assert.equal(blocks?.[0]?.kind, "text");
  assert.equal(blocks?.[0]?.text, "I should inspect this first.");
  assert.deepEqual(textDeltaFromPiEvent(event), {
    kind: "text",
    delta: "I should inspect this first.",
  });
});

test("explicit reasoning deltas render under reasoning", () => {
  const event = {
    type: "message_update",
    assistantMessageEvent: {
      type: "reasoning_delta",
      delta: "I should inspect this first.",
    },
  };

  const blocks = applyAssistantPiEventToBlocks([], event);
  assert.equal(blocks?.[0]?.kind, "thinking");
  assert.equal(blocks?.[0]?.text, "I should inspect this first.");
  assert.deepEqual(textDeltaFromPiEvent(event), {
    kind: "thinking",
    delta: "I should inspect this first.",
  });
});

test("text delta coalescer preserves alternating text and reasoning order", () => {
  const applied: Record<string, unknown>[] = [];
  const coalescer = createTextDeltaCoalescer({
    applyPiEvent: (_sessionId, _assistantId, event) => {
      applied.push(event);
    },
    scheduleFrame: () => ({ cancel: () => {} }),
  });

  const event = (type: string, delta: string) => ({
    type: "message_update",
    assistantMessageEvent: { type, delta },
  });

  coalescer.enqueuePiEvent(
    "s-main",
    "a-main",
    event("text_delta", "Visible A."),
  );
  coalescer.enqueuePiEvent(
    "s-main",
    "a-main",
    event("reasoning_delta", "Thinking B."),
  );
  coalescer.enqueuePiEvent(
    "s-main",
    "a-main",
    event("text_delta", "Visible C."),
  );
  coalescer.flushNow("s-main");

  assert.deepEqual(
    applied.map((entry) => {
      const ame = entry.assistantMessageEvent as
        | Record<string, unknown>
        | undefined;
      return { type: ame?.type, delta: ame?.delta };
    }),
    [
      { type: "text_delta", delta: "Visible A." },
      { type: "thinking_delta", delta: "Thinking B." },
      { type: "text_delta", delta: "Visible C." },
    ],
  );
});

test("final answer snapshots preserve paragraph and list boundaries between text parts", () => {
  // Snapshots now carry the model's whitespace verbatim (the controller no
  // longer drops repeated-prefix tokens), so adjacent text parts concatenate
  // exactly — no boundary guessing.
  const parts = [
    "The lamp looks static.\n\n",
    "Specific things that feel wrong:\n",
    "- The wax is one continuous blob.\n",
    "- There is no visible liquid medium.\n\n",
    "So: the wax behavior is the biggest problem.",
  ];
  const blocks = blocksFromTurnSnapshots([parts.map((text) => ({ type: "text", text }))]);

  assert.equal(blocks.length, 1);
  assert.equal(blocks[0]?.kind === "text" ? blocks[0].text : "", parts.join(""));
});

test("final answer snapshots concatenate text parts verbatim without synthesizing whitespace", () => {
  const parts = ["Examples:\n- ", "General software engineering skills.\n- ", "UI/docs skills."];
  const blocks = blocksFromTurnSnapshots([parts.map((text) => ({ type: "text", text }))]);

  assert.equal(blocks.length, 1);
  assert.equal(blocks[0]?.kind === "text" ? blocks[0].text : "", parts.join(""));
});

test("final answer snapshot merge keeps word continuations together", () => {
  const blocks = blocksFromTurnSnapshots([
    [
      { type: "text", text: "Spec" },
      { type: "text", text: "ulative decoding optimizes inference latency." },
    ],
  ]);

  assert.equal(
    blocks[0]?.kind === "text" ? blocks[0].text : "",
    "Speculative decoding optimizes inference latency.",
  );
});

test("live pre-tool text collapses with the following tool call", () => {
  const textEvent = {
    type: "message_update",
    assistantMessageEvent: {
      type: "text_delta",
      delta: "Let me inspect that first.",
      contentIndex: 0,
      partial: {
        role: "assistant",
        content: [{ type: "text", text: "Let me inspect that first." }],
      },
    },
  };
  const toolEvent = {
    type: "message_update",
    assistantMessageEvent: {
      type: "toolcall_start",
      contentIndex: 1,
      toolCall: {
        id: "call-read",
        name: "read",
        arguments: { path: "/workspace/package.json" },
      },
    },
  };

  const textBlocks = applyAssistantPiEventToBlocks([], textEvent) ?? [];
  assert.equal(textBlocks[0]?.kind, "text");

  const blocks = applyAssistantPiEventToBlocks(textBlocks, toolEvent);
  assert.equal(blocks?.[0]?.kind, "thinking");
  assert.equal(blocks?.[0]?.text, "Let me inspect that first.");
  assert.equal(blocks?.[1]?.kind, "tool");
});

test("tool call deltas use pi-provided partial arguments", () => {
  const findTool = (
    blocks: NonNullable<ReturnType<typeof applyAssistantPiEventToBlocks>>,
  ) => blocks.find((block) => block.kind === "tool");
  let blocks =
    applyAssistantPiEventToBlocks([], {
      type: "message_update",
      assistantMessageEvent: {
        type: "toolcall_delta",
        toolCallId: "call-write",
        toolName: "write_file",
        delta: '{"path":"/tmp',
        partial: {
          role: "assistant",
          content: [
            {
              type: "toolCall",
              id: "call-write",
              name: "write_file",
              arguments: { path: "/tmp" },
            },
          ],
        },
      },
    }) ?? [];

  let tool = findTool(blocks);
  assert.equal(tool?.kind, "tool");
  assert.equal(tool?.kind === "tool" ? tool.args?.path : undefined, "/tmp");

  blocks =
    applyAssistantPiEventToBlocks(blocks, {
      type: "message_update",
      assistantMessageEvent: {
        type: "toolcall_delta",
        toolCallId: "call-write",
        toolName: "write_file",
        delta: '/file.txt","content":"hello',
        partial: {
          role: "assistant",
          content: [
            {
              type: "toolCall",
              id: "call-write",
              name: "write_file",
              arguments: { path: "/tmp/file.txt", content: "hello" },
            },
          ],
        },
      },
    }) ?? [];

  tool = findTool(blocks);
  assert.equal(tool?.kind, "tool");
  assert.equal(
    tool?.kind === "tool" ? tool.args?.path : undefined,
    "/tmp/file.txt",
  );
  assert.equal(tool?.kind === "tool" ? tool.args?.content : undefined, "hello");
});

test("vllm pi model config uses pi openai-compatible parsing without reasoning controls", () => {
  const [model] = modelsToPiModels([
    {
      id: "step-3.7-flash",
      name: "Step 3.7 Flash",
      provider: "vllm-studio",
      contextWindow: 262_144,
      maxTokens: 65_536,
      reasoning: true,
      vision: true,
      active: true,
    },
  ]);

  assert.equal(model?.compat?.supportsDeveloperRole, false);
  assert.equal(model?.compat?.supportsReasoningEffort, false);
  assert.equal(model?.compat?.maxTokensField, "max_tokens");
  assert.equal(model?.compat?.supportsUsageInStreaming, true);
});

test("nex n2 models infer vision support from sparse openai model rows", () => {
  const [model] = normalizeOpenAIModels({
    data: [
      {
        id: "nex-n2-pro",
        object: "model",
        max_model_len: 262_144,
      },
    ],
  });

  assert.equal(model?.vision, true);
  assert.deepEqual(modelsToPiModels(model ? [model] : [])[0]?.input, ["text", "image"]);
});

test("vllm pi openai serialization keeps tool calls out of assistant content", () => {
  const [model] = modelsToPiModels([
    {
      id: "nex-n2-pro",
      name: "Nex N2 Pro",
      provider: "vllm-studio",
      contextWindow: 262_144,
      maxTokens: 65_536,
      reasoning: true,
      vision: false,
      active: true,
    },
  ]);
  assert.ok(model);

  const compat = {
    supportsStore: false,
    supportsDeveloperRole: false,
    supportsReasoningEffort: false,
    supportsUsageInStreaming: true,
    maxTokensField: "max_tokens",
    requiresToolResultName: false,
    requiresAssistantAfterToolResult: false,
    requiresThinkingAsText: false,
    requiresReasoningContentOnAssistantMessages: false,
    thinkingFormat: "openai",
    openRouterRouting: {},
    vercelGatewayRouting: {},
    zaiToolStream: false,
    supportsStrictMode: false,
    sendSessionAffinityHeaders: false,
    supportsLongCacheRetention: true,
  } as Parameters<typeof convertMessages>[2];

  const messages = convertMessages(
    model as Parameters<typeof convertMessages>[0],
    {
      messages: [
        {
          role: "assistant",
          content: [
            {
              type: "toolCall",
              id: "call-write",
              name: "write",
              arguments: { path: "/tmp/file.txt", content: "hello" },
            },
          ],
          api: "openai-completions",
          provider: "vllm-studio",
          model: "nex-n2-pro",
          stopReason: "toolUse",
          timestamp: Date.now(),
        },
        {
          role: "toolResult",
          toolCallId: "call-write",
          toolName: "write",
          content: [{ type: "text", text: "Successfully wrote /tmp/file.txt" }],
          isError: false,
          timestamp: Date.now(),
        },
        {
          role: "user",
          content: "What did you change?",
          timestamp: Date.now(),
        },
      ],
    } as Parameters<typeof convertMessages>[1],
    compat,
  );

  assert.equal(messages.length, 3);
  const assistant = messages[0] as Record<string, unknown>;
  assert.equal(assistant.role, "assistant");
  assert.equal(assistant.content, null);
  assert.deepEqual(assistant.tool_calls, [
    {
      id: "call-write",
      type: "function",
      function: {
        name: "write",
        arguments: JSON.stringify({ path: "/tmp/file.txt", content: "hello" }),
      },
    },
  ]);
  assert.equal((messages[1] as Record<string, unknown>).role, "tool");
  assert.equal(
    (messages[1] as Record<string, unknown>).tool_call_id,
    "call-write",
  );
  assert.equal((messages[2] as Record<string, unknown>).role, "user");
});

test("vllm pi openai serialization preserves assistant text part boundaries", () => {
  const [model] = modelsToPiModels([
    {
      id: "nex-n2-pro",
      name: "Nex N2 Pro",
      provider: "vllm-studio",
      contextWindow: 262_144,
      maxTokens: 65_536,
      reasoning: false,
      vision: false,
      active: true,
    },
  ]);
  assert.ok(model);

  const compat = {
    supportsStore: false,
    supportsDeveloperRole: false,
    supportsReasoningEffort: false,
    supportsUsageInStreaming: true,
    maxTokensField: "max_tokens",
    requiresToolResultName: false,
    requiresAssistantAfterToolResult: false,
    requiresThinkingAsText: false,
    requiresReasoningContentOnAssistantMessages: false,
    thinkingFormat: "openai",
    openRouterRouting: {},
    vercelGatewayRouting: {},
    zaiToolStream: false,
    supportsStrictMode: false,
    sendSessionAffinityHeaders: false,
    supportsLongCacheRetention: true,
  } as Parameters<typeof convertMessages>[2];

  const messages = convertMessages(
    model as Parameters<typeof convertMessages>[0],
    {
      messages: [
        {
          role: "assistant",
          content: [
            { type: "text", text: "The lamp looks static." },
            { type: "text", text: "Specific things that feel wrong:" },
            { type: "text", text: "- The wax is one continuous blob." },
            { type: "text", text: "-There is no visible liquid medium." },
            { type: "text", text: "So: the wax behavior is the biggest problem." },
          ],
          api: "openai-completions",
          provider: "vllm-studio",
          model: "nex-n2-pro",
          stopReason: "stop",
          timestamp: Date.now(),
        },
        {
          role: "user",
          content: "Keep going.",
          timestamp: Date.now(),
        },
      ],
    } as Parameters<typeof convertMessages>[1],
    compat,
  );

  assert.equal(
    (messages[0] as Record<string, unknown>).content,
    [
      "The lamp looks static.",
      "",
      "Specific things that feel wrong:",
      "- The wax is one continuous blob.",
      "- There is no visible liquid medium.",
      "",
      "So: the wax behavior is the biggest problem.",
    ].join("\n"),
  );
});

test("reasoning then pre-tool narration then tool keeps activity together", () => {
  const reasoningEvent = {
    type: "message_update",
    assistantMessageEvent: {
      type: "reasoning_delta",
      delta: "Internal reasoning before the answer.",
    },
  };
  const textEvent = {
    type: "message_update",
    assistantMessageEvent: {
      type: "text_delta",
      delta: "Here is the answer.",
    },
  };
  const toolEvent = {
    type: "message_update",
    assistantMessageEvent: {
      type: "toolcall_start",
      toolCall: {
        id: "call-read",
        name: "read",
        arguments: { path: "/workspace/file.txt" },
      },
    },
  };

  const afterReasoning =
    applyAssistantPiEventToBlocks([], reasoningEvent) ?? [];
  const afterText =
    applyAssistantPiEventToBlocks(afterReasoning, textEvent) ?? [];
  const blocks = applyAssistantPiEventToBlocks(afterText, toolEvent) ?? [];

  assert.equal(blocks[0]?.kind, "thinking");
  assert.match(blocks[0]?.text ?? "", /Internal reasoning before the answer/);
  assert.match(blocks[0]?.text ?? "", /Here is the answer/);
  assert.equal(blocks[1]?.kind, "tool");
});

test("visible answer text after a tool call stays after the collapsed activity", () => {
  const narrationEvent = {
    type: "message_update",
    assistantMessageEvent: {
      type: "text_delta",
      delta: "Let me inspect that first.",
    },
  };
  const toolStartEvent = {
    type: "message_update",
    assistantMessageEvent: {
      type: "toolcall_start",
      toolCall: {
        id: "call-read",
        name: "read",
        arguments: { path: "/workspace/file.txt" },
      },
    },
  };
  const answerEvent = {
    type: "message_update",
    assistantMessageEvent: {
      type: "text_delta",
      delta: "Here is the answer.",
    },
  };

  const afterNarration =
    applyAssistantPiEventToBlocks([], narrationEvent) ?? [];
  const afterTool =
    applyAssistantPiEventToBlocks(afterNarration, toolStartEvent) ?? [];
  const blocks = applyAssistantPiEventToBlocks(afterTool, answerEvent) ?? [];

  assert.equal(blocks[0]?.kind, "thinking");
  assert.equal(blocks[0]?.text, "Let me inspect that first.");
  assert.equal(blocks[1]?.kind, "tool");
  assert.equal(blocks[2]?.kind, "text");
  assert.equal(blocks[2]?.text, "Here is the answer.");
});

test("late reasoning deltas move before visible text without splitting the answer", () => {
  const textStart = {
    type: "message_update",
    assistantMessageEvent: {
      type: "text_delta",
      delta: "Spec",
    },
  };
  const reasoningEvent = {
    type: "message_update",
    assistantMessageEvent: {
      type: "reasoning_delta",
      delta: "The model reasoned before answering.",
    },
  };
  const textRest = {
    type: "message_update",
    assistantMessageEvent: {
      type: "text_delta",
      delta: "ulative decoding optimizes inference latency.",
    },
  };

  const afterStart = applyAssistantPiEventToBlocks([], textStart) ?? [];
  const afterReasoning =
    applyAssistantPiEventToBlocks(afterStart, reasoningEvent) ?? [];
  const blocks = applyAssistantPiEventToBlocks(afterReasoning, textRest) ?? [];

  assert.equal(blocks.length, 2);
  assert.equal(blocks[0]?.kind, "thinking");
  assert.equal(blocks[0]?.text, "The model reasoned before answering.");
  assert.equal(blocks[1]?.kind, "text");
  assert.equal(
    blocks[1]?.text,
    "Speculative decoding optimizes inference latency.",
  );
});

test("tool_execution_start collapses pending narration with tool activity", () => {
  const textBlocks =
    applyAssistantPiEventToBlocks([], {
      type: "message_update",
      assistantMessageEvent: {
        type: "text_delta",
        delta: "I'll run a quick check.",
      },
    }) ?? [];

  const blocks = applyAssistantPiEventToBlocks(textBlocks, {
    type: "tool_execution_start",
    toolCallId: "call-bash",
    toolName: "bash",
  });

  assert.equal(blocks?.[0]?.kind, "thinking");
  assert.equal(blocks?.[0]?.text, "I'll run a quick check.");
  assert.equal(blocks?.[1]?.kind, "tool");
});

test("replayed tool-use narration renders as reasoning, not visible answer text", () => {
  const { messages } = replaySessionEvents([
    {
      type: "message",
      message: {
        role: "user",
        content: [{ type: "text", text: "inspect the project" }],
      },
    },
    {
      type: "message",
      message: {
        role: "assistant",
        stopReason: "toolUse",
        content: [
          {
            type: "text",
            text: "Now I need to inspect the package files before answering.",
          },
          {
            type: "toolCall",
            id: "call-read",
            name: "read",
            arguments: { path: "/workspace/package.json" },
          },
        ],
      },
    },
  ]);

  const assistant = messages.find((message) => message.role === "assistant");
  assert.equal(assistant?.text, "");
  assert.equal(assistant?.blocks?.[0]?.kind, "thinking");
  assert.match(assistant?.blocks?.[0]?.text ?? "", /inspect the package files/);
  assert.equal(assistant?.blocks?.[1]?.kind, "tool");
});

test("replay patches streamed assistant final messages instead of duplicating them", () => {
  const { messages } = replaySessionEvents([
    {
      type: "message",
      message: {
        role: "user",
        content: [{ type: "text", text: "inspect the project" }],
      },
    },
    {
      type: "message_update",
      assistantMessageEvent: {
        type: "text_delta",
        delta: "I will inspect first.",
      },
    },
    {
      type: "message_update",
      assistantMessageEvent: {
        type: "toolcall_start",
        toolCall: {
          id: "call-read",
          name: "read",
          arguments: { path: "/workspace/package.json" },
        },
      },
    },
    {
      type: "message",
      message: {
        role: "assistant",
        stopReason: "toolUse",
        content: [
          { type: "text", text: "I will inspect first." },
          {
            type: "toolCall",
            id: "call-read",
            name: "read",
            arguments: { path: "/workspace/package.json" },
          },
        ],
      },
    },
  ]);

  const assistantMessages = messages.filter(
    (message) => message.role === "assistant",
  );
  assert.equal(assistantMessages.length, 1);
  assert.equal(assistantMessages[0]?.blocks?.[0]?.kind, "thinking");
  assert.equal(assistantMessages[0]?.blocks?.[1]?.kind, "tool");
});

test("live final assistant messages hydrate placeholders when no deltas streamed", () => {
  const harness = makePiEventApplierHarness(
    makeSession("s-main", {
      messages: [
        { id: "u1", role: "user", text: "define kv cache" },
        {
          id: "a-main",
          role: "assistant",
          text: "",
          blocks: [{ kind: "text", id: "text-loading", text: "…" }],
        },
      ],
      activeAssistantId: "a-main",
    }),
  );

  harness.apply("s-main", "a-main", {
    type: "message",
    message: {
      role: "assistant",
      content: [
        {
          type: "text",
          text: "A KV cache stores prior attention keys and values so generation can reuse them.",
        },
      ],
    },
  });

  const assistant = harness
    .session()
    .messages.find((message) => message.id === "a-main");
  assert.equal(
    assistant?.text,
    "A KV cache stores prior attention keys and values so generation can reuse them.",
  );
  assert.equal(assistant?.blocks?.[0]?.kind, "text");
  assert.equal(
    assistant?.blocks?.[0]?.text,
    "A KV cache stores prior attention keys and values so generation can reuse them.",
  );
});

test("live final assistant messages do not duplicate streamed blocks", () => {
  const harness = makePiEventApplierHarness(
    makeSession("s-main", {
      messages: [
        { id: "u1", role: "user", text: "explain attention" },
        {
          id: "a-main",
          role: "assistant",
          text: "",
          blocks: [{ kind: "text", id: "text-1", text: "Already streamed." }],
        },
      ],
      activeAssistantId: "a-main",
    }),
  );

  harness.apply("s-main", "a-main", {
    type: "message",
    message: {
      role: "assistant",
      content: [{ type: "text", text: "Already streamed." }],
    },
  });

  const assistant = harness
    .session()
    .messages.find((message) => message.id === "a-main");
  assert.equal(assistant?.blocks?.length, 1);
  assert.equal(assistant?.blocks?.[0]?.kind, "text");
  assert.equal(assistant?.blocks?.[0]?.text, "Already streamed.");
});

test("live final assistant messages reconcile partial streamed text", () => {
  const harness = makePiEventApplierHarness(
    makeSession("s-main", {
      messages: [
        { id: "u1", role: "user", text: "define speculative decoding" },
        {
          id: "a-main",
          role: "assistant",
          text: "",
          blocks: [{ kind: "text", id: "text-1", text: "Spec" }],
        },
      ],
      activeAssistantId: "a-main",
    }),
  );

  harness.apply("s-main", "a-main", {
    type: "message",
    message: {
      role: "assistant",
      content: [
        {
          type: "text",
          text: "Speculative decoding optimizes inference latency.",
        },
        {
          type: "thinking",
          thinking:
            "The model reasoned before answering, even if the final payload listed it second.",
        },
      ],
    },
  });

  const assistant = harness
    .session()
    .messages.find((message) => message.id === "a-main");
  assert.equal(assistant?.blocks?.length, 2);
  assert.equal(assistant?.blocks?.[0]?.kind, "thinking");
  assert.equal(
    assistant?.blocks?.[0]?.text,
    "The model reasoned before answering, even if the final payload listed it second.",
  );
  assert.equal(assistant?.blocks?.[1]?.kind, "text");
  assert.equal(
    assistant?.blocks?.[1]?.text,
    "Speculative decoding optimizes inference latency.",
  );
});

test("assistant message_end error becomes visible without replay navigation", () => {
  const harness = makePiEventApplierHarness(
    makeSession("s-main", {
      messages: [
        { id: "u1", role: "user", text: "continue" },
        {
          id: "a-main",
          role: "assistant",
          text: "",
          blocks: [],
        },
      ],
      activeAssistantId: "a-main",
    }),
  );

  harness.apply("s-main", "a-main", {
    type: "message_end",
    message: {
      role: "assistant",
      stopReason: "error",
      errorMessage: "fetch failed",
      content: [{ type: "text", text: "Partial answer" }],
    },
  });

  const assistant = harness
    .session()
    .messages.find((message) => message.id === "a-main");
  assert.equal(harness.session().error, "fetch failed");
  assert.equal(assistant?.blocks?.at(-1)?.kind, "event");
  assert.equal(assistant?.blocks?.at(-1)?.text, "fetch failed");
});

test("settled assistant error messages hydrate visible error blocks", () => {
  const harness = makePiEventApplierHarness(
    makeSession("s-main", {
      messages: [
        { id: "u1", role: "user", text: "continue" },
        {
          id: "a-main",
          role: "assistant",
          text: "",
          blocks: [],
        },
      ],
      activeAssistantId: "a-main",
    }),
  );

  harness.apply("s-main", "a-main", {
    type: "message",
    message: {
      role: "assistant",
      stopReason: "error",
      errorMessage: "provider overloaded",
      content: [],
    },
  });

  const assistant = harness
    .session()
    .messages.find((message) => message.id === "a-main");
  assert.equal(harness.session().error, "provider overloaded");
  assert.equal(assistant?.blocks?.[0]?.kind, "event");
  assert.equal(assistant?.blocks?.[0]?.text, "provider overloaded");
});

test("activity group ids stay stable as streaming blocks append", () => {
  const first = groupAssistantBlocks([
    { kind: "thinking", id: "0:0:thinking", text: "Thinking" },
    {
      kind: "tool",
      id: "call-read",
      name: "read",
      status: "running",
      text: "{}",
      argsText: "{}",
    },
  ]);
  const second = groupAssistantBlocks([
    { kind: "thinking", id: "0:0:thinking", text: "Thinking" },
    { kind: "thinking", id: "0:1:thinking", text: " more" },
    {
      kind: "tool",
      id: "call-read",
      name: "read",
      status: "running",
      text: "{}",
      argsText: "{}",
    },
    {
      kind: "tool",
      id: "call-write",
      name: "write",
      status: "running",
      text: "{}",
      argsText: "{}",
    },
  ]);

  const firstActivity = first[0];
  const secondActivity = second[0];
  if (
    firstActivity?.kind !== "activity-group" ||
    secondActivity?.kind !== "activity-group"
  ) {
    throw new Error("expected activity groups");
  }
  assert.equal(firstActivity.id, secondActivity.id);
});

test("skill mentions and selected skill context survive composer prompt construction", () => {
  const mention = detectComposerMention("use $browser", "use $browser".length);
  const skills = [
    {
      id: "skill-browser",
      name: "browser",
      path: "/skills/browser",
      instructions: "Use browser tools.",
    },
  ];

  assert.deepEqual(mention, {
    kind: "skill",
    query: "browser",
    start: 4,
    end: 12,
  });
  assert.match(
    selectedContextPrompt("open the page", [], skills),
    /Loaded skills:/,
  );
  assert.match(
    selectedContextPrompt("open the page", [], skills),
    /Use browser tools/,
  );
  assert.match(
    selectedContextInstructions([], skills),
    /Preserve this selected composer context/,
  );
});
