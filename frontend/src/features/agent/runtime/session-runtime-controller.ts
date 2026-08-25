// THE single owner of live session event ordering AND of runtime-derived
// session status. This module — and only this module — opens runtime SSE
// subscriptions, holds each session's pi transcript state, reconnects,
// schedules projection commits, reduces runtime meta events into session
// state, and runs the runtime-list poll that arbitrates running/idle. React
// integrates through a thin binding (use-workspace-runtime-sync.ts); nothing
// else may subscribe to runtime events or settle a session's runtime status.
// (Turn-intent status — "starting", accept, abort — stays with
// prompt-stream/engine; hydration status with loadAndReplay.)
//
// Transcript content is snapshot-authoritative (docs/agent-state-plan.md,
// Stage A): the runtime streams pi's own `SessionSnapshot` + progress frames,
// pi's client reducer folds them, and one adapter projects the result into
// the timeline's messages. The legacy `{type:"pi"}` frames still drive
// session METADATA (status arbitration, queue, usage, extension UI) until
// Stages B–D move those onto the snapshot too.

import { isAgentSettledEvent } from "@shared/agent/pi-events";
import { piSessionIdFromEvent } from "@/features/agent/messages";
import {
  listRuntimeSessions,
  loadRuntimeStatus,
  runtimeContextUsage,
  subscribeRuntimeEvents,
  type RuntimeEventPayload,
  type RuntimeEventSubscription,
  type RuntimeSessionSummary,
  type RuntimeStatus,
} from "@/features/agent/runtime/api";
import { reduceSessionMetaEvent } from "@/features/agent/runtime/session-meta-reducer";
import {
  applyTranscriptProgress,
  asSessionSnapshot,
  asTranscriptProgress,
  createTranscriptState,
  mergeProjectedMessages,
  selectTranscript,
  transcriptToMessages,
  type AdapterCache,
  type SessionSnapshot,
  type TranscriptItem,
  type TranscriptState,
} from "@/features/agent/pi";
import { Effect, Fiber, Schedule } from "effect";
import type { Session, SessionId } from "@/features/agent/runtime/types";
import { publishRuntimeActivity } from "@/features/agent/session-index";
import { settleTurn, shouldSubscribeRuntimeEvents } from "@/features/agent/runtime/session-status";

const RESUME_IDLE_RECONNECT_MS = 15_000;
const RESUME_RECONNECT_DELAY_MS = 1_000;
const RUNTIME_POLL_INTERVAL_MS = 5_000;
const RUNTIME_POLL_IDLE_GRACE_MS = 10_000;

export type SessionRuntimeBinding = {
  /** Single state commit boundary — one patchSession dispatch per call. */
  commit: (sessionId: SessionId, patch: (session: Session) => Session) => void;
  /** Read the current session snapshot (never cached by the controller). */
  getSession: (sessionId: SessionId) => Session | undefined;
  /** Read all current workspace sessions (the binding's live ref). */
  getSessions: () => readonly Session[];
};

export type SessionRuntimeController = {
  bind(binding: SessionRuntimeBinding): void;
  unbind(): void;
  /**
   * Reconcile live SSE attachments against the session set: attach sessions
   * entering the live set, detach those leaving, recreate only when the
   * connection params (runtime/pi id) change.
   */
  reconcile(sessions: readonly Session[]): void;
  /**
   * A `/turn` command was accepted. Pi's per-runtime event seq restarts ONLY
   * when the runtime itself restarts — `runtimeEventSeq` is the runtime's
   * current seq from the accept response. Rewind the gate (and drop the
   * transcript's revision floor) only when that seq sits below what we've
   * already received: a genuine restart, whose fresh runtime also restarts
   * snapshot revisions from zero.
   */
  noteTurnAccepted(sessionId: SessionId, assistantId?: string, runtimeEventSeq?: number): void;
  /**
   * loadAndReplay hydrated the transcript up to `committedSeq` (undefined when
   * the runtime is idle): reattach from there so EventSource does not replay
   * already-processed meta events.
   */
  noteReplayHydrated(sessionId: SessionId, committedSeq: number | undefined): void;
  /** Seed a session's transcript from a canonical snapshot (hydration). A
   *  fresher live snapshot for the same pi session is never downgraded. */
  seedSnapshot(sessionId: SessionId, snapshot: SessionSnapshot): void;
  /** Prepend older transcript items (a "load earlier" page). Items whose ids
   *  are already present are skipped. */
  prependTranscript(sessionId: SessionId, items: readonly TranscriptItem[]): void;
  /** Apply any scheduled-but-uncommitted projection for a session right now. */
  flush(sessionId: SessionId): void;
  /**
   * Reconcile every session against the runtime list right now, then restart
   * the steady poll. Called by the React binding when poll-relevant session
   * identity (membership / pi id / status) changes.
   */
  pollNow(): void;
  /** Flush everything and close every SSE attachment (workspace unmount). */
  closeAll(): void;
  /**
   * The connection key a session is currently addressed by on the runtime API.
   * Normally the session's own runtime key; after a restart adoption it is the
   * controller-internal override recorded by the poll's pi-session match.
   */
  connectionKey(sessionId: SessionId): string;
  /**
   * Seed the connection-key override from a legacy persisted runtime id (a
   * pre-alias `rt-*` value read once from old localStorage state), so a session
   * that was RUNNING under that key across the upgrade reattaches to it.
   */
  seedConnectionKey(sessionId: SessionId, runtimeKey: string): void;
};

type Attachment = { key: string; close: () => void };

// Per-session pi transcript state. `snapshotRevision` is the floor of the last
// accepted snapshot (backlog progress at or below it is already contained in
// the snapshot); `appliedRevision` is the highest progress revision folded in.
// `acceptAnyRevision` is armed on a detected runtime restart, where the fresh
// runtime's revisions restart from zero and must not be mistaken for stale.
type TranscriptTrack = {
  state: TranscriptState;
  snapshotRevision: number;
  appliedRevision: number;
  acceptAnyRevision: boolean;
};

function resumeConnectionKey(connectionKey: string, piSessionId: string | null): string {
  return `${connectionKey}|${piSessionId ?? ""}`;
}

function patchRuntimeStatus(status: RuntimeStatus): Partial<Session> {
  return {
    ...(status.piSessionId ? { piSessionId: status.piSessionId } : {}),
    ...(status.modelId ? { modelId: status.modelId } : {}),
    ...(status.contextUsage !== undefined ? { contextUsage: status.contextUsage } : {}),
  };
}

function sameRuntimePatch(session: Session, patch: Partial<Session>, status: string): boolean {
  return (
    session.status === status &&
    (patch.piSessionId === undefined || session.piSessionId === patch.piSessionId) &&
    (patch.modelId === undefined || session.modelId === patch.modelId) &&
    (patch.contextUsage === undefined ||
      JSON.stringify(session.contextUsage ?? null) === JSON.stringify(patch.contextUsage ?? null))
  );
}

// A first-turn session can stream progress before the runtime has a snapshot
// to send (the pi session is being created as the events flow). Fold those
// deltas into an empty world; the first real snapshot replaces it wholesale
// and, with deterministic item ids, React never notices the swap.
function bootstrapSnapshot(sessionId: SessionId): SessionSnapshot {
  return {
    id: `bootstrap:${sessionId}`,
    cwd: "/",
    createdAt: 0,
    updatedAt: 0,
    phase: "turn",
    model: { provider: "unknown", id: "unknown" },
    thinkingLevel: "off",
    attached: true,
    locked: false,
    revision: 0,
    transcript: [],
    queuedSteer: [],
    queuedSteerCount: 0,
  };
}

const scheduleFrame: (callback: () => void) => void =
  typeof requestAnimationFrame === "function"
    ? (callback) => requestAnimationFrame(() => callback())
    : (callback) => void setTimeout(callback, 16);

export function createSessionRuntimeController(): SessionRuntimeController {
  let binding: SessionRuntimeBinding | null = null;
  const attachments = new Map<SessionId, Attachment>();
  let pollTimer: ReturnType<typeof setInterval> | null = null;
  let pollEpoch = 0;
  const turnAcceptedAt = new Map<SessionId, number>();
  // When the SSE delivered an authoritative `agent_settled` for a session. The
  // server's runtime list drops the just-finished runtime lazily, so for a few
  // seconds after the turn ends the poll can still see it as active. Without a
  // guard the poll's active branch re-promotes the session to "running",
  // fighting the SSE's idle and oscillating status (visible flicker + SSE
  // reopen churn). This stamp lets the active branch honor the finish grace.
  const turnFinishedAt = new Map<SessionId, number>();
  // Ephemeral per-session connection-key overrides — reconnection plumbing, not
  // session state. Set when the poll's pi-session match finds this session's
  // runtime living under a DIFFERENT server key (a restart adoption, or a
  // legacy pre-alias `rt-*` key seeded across an upgrade); every runtime API
  // address for the session then uses the override instead of the session id.
  const connectionKeyOverrides = new Map<SessionId, string>();
  // Highest legacy event seq seen per session: the duplicate gate for meta
  // events and the SSE reconnect cursor. Transcript frames are ordered by
  // snapshot revision instead and never consult this.
  const lastSeq = new Map<SessionId, number>();
  const transcripts = new Map<SessionId, TranscriptTrack>();
  const adapterCaches = new Map<SessionId, AdapterCache>();
  const pendingCommits = new Set<SessionId>();
  let commitScheduled = false;

  const connectionKeyFor = (session: Session): string =>
    connectionKeyOverrides.get(session.id) ?? session.id;

  // Sessions evicted from the workspace registry (closed panes, pruned
  // background sessions) must not leave app-lifetime entries behind in this
  // singleton's per-session maps. Only truly-gone ids are pruned —
  // idle-but-open sessions keep their cursor and transcript state.
  const pruneStaleSessionEntries = (knownIds: ReadonlySet<SessionId>): void => {
    const maps: Array<Map<SessionId, unknown>> = [
      lastSeq,
      turnAcceptedAt,
      turnFinishedAt,
      connectionKeyOverrides,
      transcripts,
      adapterCaches,
    ];
    for (const map of maps) {
      for (const sessionId of [...map.keys()]) {
        if (!knownIds.has(sessionId)) map.delete(sessionId);
      }
    }
    for (const sessionId of [...pendingCommits]) {
      if (!knownIds.has(sessionId)) pendingCommits.delete(sessionId);
    }
  };

  const commit = (sessionId: SessionId, patch: (session: Session) => Session) => {
    binding?.commit(sessionId, patch);
  };

  // Stamp the highest processed seq onto the session so a session restored
  // from storage can seed its first SSE attach past the already-seen backlog.
  const stampSeq = (session: Session, seq: number | undefined): Session => {
    if (typeof seq !== "number") return session;
    if (typeof session.lastEventSeq === "number" && seq <= session.lastEventSeq) return session;
    return { ...session, lastEventSeq: seq };
  };

  /* ── transcript projection ──────────────────────────────────────────────── */

  const commitTranscript = (sessionId: SessionId) => {
    pendingCommits.delete(sessionId);
    const track = transcripts.get(sessionId);
    if (!track) return;
    let cache = adapterCaches.get(sessionId);
    if (!cache) {
      cache = new Map();
      adapterCaches.set(sessionId, cache);
    }
    const projected = transcriptToMessages(selectTranscript(track.state), {
      phase: track.state.snapshot.phase,
      cache,
    });
    commit(sessionId, (session) => ({
      ...session,
      messages: mergeProjectedMessages(session.messages, projected),
    }));
  };

  // Streamed deltas arrive far faster than paint; fold them into the reducer
  // state synchronously and project into React state once per frame.
  const scheduleTranscriptCommit = (sessionId: SessionId) => {
    pendingCommits.add(sessionId);
    if (commitScheduled) return;
    commitScheduled = true;
    scheduleFrame(() => {
      commitScheduled = false;
      const due = [...pendingCommits];
      pendingCommits.clear();
      for (const id of due) commitTranscript(id);
    });
  };

  const acceptSnapshot = (sessionId: SessionId, snapshot: SessionSnapshot): boolean => {
    const track = transcripts.get(sessionId);
    const fresh =
      !track ||
      track.acceptAnyRevision ||
      track.state.snapshot.id !== snapshot.id ||
      snapshot.revision >= track.appliedRevision;
    if (!fresh) return false;
    transcripts.set(sessionId, {
      state: createTranscriptState(snapshot),
      snapshotRevision: snapshot.revision,
      appliedRevision: snapshot.revision,
      acceptAnyRevision: false,
    });
    return true;
  };

  const applySnapshotPayload = (
    sessionId: SessionId,
    payload: Extract<RuntimeEventPayload, { type: "snapshot" }>,
  ) => {
    const snapshot = asSessionSnapshot(payload.snapshot);
    if (!snapshot) return;
    if (acceptSnapshot(sessionId, snapshot)) commitTranscript(sessionId);
  };

  const applyProgressPayload = (
    sessionId: SessionId,
    payload: Extract<RuntimeEventPayload, { type: "progress" }>,
  ) => {
    const progress = asTranscriptProgress(payload.progress);
    if (!progress) return;
    let track = transcripts.get(sessionId);
    if (!track) {
      track = {
        state: createTranscriptState(bootstrapSnapshot(sessionId)),
        snapshotRevision: -1,
        appliedRevision: -1,
        acceptAnyRevision: false,
      };
      transcripts.set(sessionId, track);
    }
    // At or below the snapshot floor the delta is already contained in the
    // snapshot (a reconnect backlog); below the applied high-water it was
    // already folded. Frames of one event share a revision, so equality with
    // the high-water must still apply.
    if (payload.revision <= track.snapshotRevision) return;
    if (payload.revision < track.appliedRevision) return;
    track.state = applyTranscriptProgress(track.state, progress);
    track.appliedRevision = Math.max(track.appliedRevision, payload.revision);
    scheduleTranscriptCommit(sessionId);
  };

  // A detected runtime restart: the fresh runtime restarts both the event seq
  // and the snapshot revision from zero, so the revision floor must not treat
  // its first snapshot as stale.
  const markRuntimeRestart = (sessionId: SessionId) => {
    lastSeq.set(sessionId, 0);
    const track = transcripts.get(sessionId);
    if (track) track.acceptAnyRevision = true;
  };

  /* ── legacy pi/meta events ──────────────────────────────────────────────── */

  const acceptSeq = (sessionId: SessionId, seq: number | undefined): boolean => {
    if (typeof seq !== "number") return true;
    if (seq <= (lastSeq.get(sessionId) ?? 0)) return false;
    lastSeq.set(sessionId, seq);
    return true;
  };

  const applyStatusPayload = (
    sessionId: SessionId,
    payload: Extract<RuntimeEventPayload, { type: "status" }>,
  ) => {
    const idle = payload.phase === "done" || payload.phase === "idle";
    commit(sessionId, (session) => ({
      ...session,
      piSessionId: payload.session?.piSessionId || session.piSessionId,
      contextUsage: runtimeContextUsage(payload.session, session.contextUsage),
      status: idle ? "idle" : session.status === "stopping" ? "stopping" : "running",
      activeAssistantId: idle ? undefined : session.activeAssistantId,
    }));
  };

  const applyPiPayload = (
    sessionId: SessionId,
    payload: Extract<RuntimeEventPayload, { type: "pi" }>,
  ) => {
    const eventId = piSessionIdFromEvent(payload.event);
    if (!acceptSeq(sessionId, payload.seq)) return;

    if (isAgentSettledEvent(payload.event)) {
      // Record the authoritative end-of-turn so the runtime poll won't
      // resurrect "running" off a stale still-active list snapshot.
      turnFinishedAt.set(sessionId, Date.now());
      // Project any pending deltas first, then settle the turn in one commit.
      // The runtime follows agent_settled with a fresh snapshot frame, which
      // carries the final tool statuses and stop reasons.
      commitTranscript(sessionId);
      commit(sessionId, (session) =>
        stampSeq(
          { ...settleTurn(session), piSessionId: eventId || session.piSessionId },
          payload.seq,
        ),
      );
      return;
    }

    // One commit per event: reduce session metadata (queue, usage, extension
    // UI, header fields) and promote to running — receiving live events IS
    // evidence the runtime is active.
    commit(sessionId, (session) => {
      let next = stampSeq(reduceSessionMetaEvent(session, payload.event), payload.seq);
      const running = next.status === "running" || next.status === "stopping";
      if (!running || (eventId && next.piSessionId !== eventId)) {
        next = {
          ...next,
          piSessionId: eventId || next.piSessionId,
          status: next.status === "stopping" ? "stopping" : "running",
        };
      }
      return next;
    });
  };

  /* ── runtime-list poll ──────────────────────────────────────────────────── */

  // True while a session sits in its post-`agent_settled` grace: the SSE already
  // settled the turn to idle, but the server's runtime list can still report
  // the finished runtime as active for a beat. A newer accepted turn supersedes
  // the finish (genuine restart) and ends the grace early.
  const withinFinishGrace = (sessionId: SessionId, fetchStartedAt: number): boolean => {
    const finishedAt = turnFinishedAt.get(sessionId);
    if (finishedAt === undefined || fetchStartedAt - finishedAt >= RUNTIME_POLL_IDLE_GRACE_MS)
      return false;
    const acceptedAt = turnAcceptedAt.get(sessionId);
    return acceptedAt === undefined || acceptedAt <= finishedAt;
  };

  // Restart adoption: the pi match found this session's runtime under a new
  // server key. Record the connection-key override (controller-internal —
  // reconnection plumbing, not session state), reset the seq gate and revision
  // floor, and reopen an existing attachment under the new key.
  const adoptConnectionKey = (
    session: Session,
    nextConnectionKey: string,
    piSessionId: string | null,
  ) => {
    markRuntimeRestart(session.id);
    commit(session.id, (current) =>
      current.lastEventSeq === undefined ? current : { ...current, lastEventSeq: undefined },
    );
    if (nextConnectionKey === session.id) {
      connectionKeyOverrides.delete(session.id);
    } else {
      connectionKeyOverrides.set(session.id, nextConnectionKey);
    }
    // The override is controller-internal — no session state changes, so the
    // React binding's reconcile will not fire. Reopen an existing attachment
    // under the new key ourselves. A session without an attachment
    // (idle -> running promotion) is picked up by the binding's reconcile
    // when the status commit lands.
    const attachment = attachments.get(session.id);
    if (attachment) {
      attachment.close();
      attachments.set(session.id, openAttachment(session.id, nextConnectionKey, piSessionId));
    }
  };

  // Reconcile the workspace sessions against one runtime-list snapshot. The
  // poll is the second leg of status arbitration next to the SSE attachments:
  // it promotes sessions whose runtime is active (including adopting a new
  // connection key via the pi-session match) and idles sessions the runtime
  // no longer reports as active.
  const applyRuntimeList = (runtimeSessions: RuntimeSessionSummary[], fetchStartedAt: number) => {
    const byRuntime = new Map(runtimeSessions.map((entry) => [entry.sessionId, entry.status]));
    const byPi = new Map(
      runtimeSessions
        .filter((entry) => entry.status.piSessionId)
        .map((entry) => [
          entry.status.piSessionId!,
          { serverKey: entry.sessionId, status: entry.status },
        ]),
    );
    const sessions = binding?.getSessions() ?? [];
    const sharedPiIds = collidingPiSessionIds(sessions);
    for (const session of sessions.filter((entry) => entry.status !== "loading")) {
      const connectionKey = connectionKeyFor(session);
      const direct = byRuntime.get(connectionKey);
      const piMatch =
        session.piSessionId && !sharedPiIds.has(session.piSessionId)
          ? byPi.get(session.piSessionId)
          : undefined;
      const status = direct ?? piMatch?.status;
      if (!status) continue;
      if (status.active === true) {
        // Post-finish grace (symmetric to the idle branch's accept grace): the
        // SSE's `agent_settled` is the authoritative end of a turn. For a few
        // seconds after it, the server's runtime list can still report the
        // just-finished runtime as active. Re-promoting to "running" off that
        // stale snapshot fights the SSE's idle and oscillates status —
        // flicker plus SSE reopen churn on every poll tick. Suppress the active
        // branch inside the grace window UNLESS a newer turn was accepted after
        // the finish (a genuine restart supersedes the finish and must recover).
        if (withinFinishGrace(session.id, fetchStartedAt)) continue;
        promoteFromRuntimeList(session, status, connectionKey, piMatch?.serverKey);
      } else if (session.status === "running" || session.status === "stopping") {
        idleFromRuntimeList(session, status, fetchStartedAt);
      }
    }
  };

  // A piSessionId held by 2+ open sessions (forked/duplicated tab, pref copy, or
  // the mid-turn adoption window before one settles) can't disambiguate which
  // session a runtime entry belongs to. Trusting the pi reverse-index there
  // would let ONE runtime entry promote/idle AND repoint every session sharing
  // the id — direct two-session crosstalk. Collect the collided ids so the
  // caller falls back to the unambiguous direct runtime match for them.
  const collidingPiSessionIds = (sessions: readonly Session[]): Set<string> => {
    const shared = new Set<string>();
    const seen = new Set<string>();
    for (const session of sessions) {
      if (!session.piSessionId) continue;
      if (seen.has(session.piSessionId)) shared.add(session.piSessionId);
      else seen.add(session.piSessionId);
    }
    return shared;
  };

  // The runtime reports this session as active: adopt a new connection key if
  // the pi match moved it, then promote to running unless it is stopping.
  const promoteFromRuntimeList = (
    session: Session,
    status: RuntimeStatus,
    connectionKey: string,
    matchedServerKey: string | undefined,
  ) => {
    const patch = patchRuntimeStatus(status);
    const nextConnectionKey = matchedServerKey ?? connectionKey;
    if (nextConnectionKey !== connectionKey) {
      adoptConnectionKey(
        session,
        nextConnectionKey,
        status.piSessionId ?? session.piSessionId ?? null,
      );
    }
    commit(session.id, (current) => {
      const nextStatus = current.status === "stopping" ? "stopping" : "running";
      if (sameRuntimePatch(current, patch, nextStatus)) return current;
      return { ...current, ...patch, status: nextStatus };
    });
  };

  // Only a session the runtime once acknowledged (status "running") may be
  // idled by the poll. A freshly-sent "starting" turn is not yet in the
  // runtime list during prefill/TTFT; idling it here would hide the
  // working indicator for several seconds until the first token lands.
  // The prompt stream's own `finally` owns the starting->terminal
  // transition, so the poll must not race it.
  //
  // Accept-vs-poll grace: a list snapshot fetched before — or shortly
  // after — a `/turn` acceptance cannot speak for the new turn, so it
  // may not idle the session either. Only the idle branch is suppressed;
  // the active branch is the recovery path and must always apply.
  const idleFromRuntimeList = (session: Session, status: RuntimeStatus, fetchStartedAt: number) => {
    const acceptedAt = turnAcceptedAt.get(session.id);
    if (acceptedAt !== undefined && fetchStartedAt - acceptedAt < RUNTIME_POLL_IDLE_GRACE_MS)
      return;
    const patch = patchRuntimeStatus(status);
    commit(session.id, (current) => {
      if (current.status !== "running" && current.status !== "stopping") return current;
      if (sameRuntimePatch(current, patch, "idle") && !current.activeAssistantId) {
        return current;
      }
      return { ...settleTurn(current), ...patch };
    });
  };

  const stopPoll = () => {
    if (pollTimer !== null) {
      clearInterval(pollTimer);
      pollTimer = null;
    }
    // Invalidate any in-flight fetch: a stale snapshot from the previous
    // session registry must not apply after a fresher immediate reconcile.
    pollEpoch += 1;
  };

  const pollOnce = () => {
    void Effect.runPromise(
      Effect.gen(function* () {
        const epoch = pollEpoch;
        const fetchStartedAt = Date.now();
        const entries = yield* Effect.tryPromise({
          try: () => listRuntimeSessions(),
          catch: (error) => error,
        });
        if (epoch !== pollEpoch || !binding) return;
        publishRuntimeActivity(entries);
        applyRuntimeList(entries, fetchStartedAt);
      }),
    );
  };

  /* ── SSE attachments ────────────────────────────────────────────────────── */

  // One SSE attachment per live session: connect, reconnect with a fixed
  // delay, watchdog the stream, and probe runtime liveness on errors.
  const openAttachment = (
    sessionId: SessionId,
    runtime: string,
    piSessionId: string | null,
  ): Attachment => {
    let closed = false;
    let reconnecting = false;
    let sub: RuntimeEventSubscription | null = null;
    let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
    let lastPayloadAt = Date.now();

    const cancelReconnect = () => {
      if (reconnectTimer !== null) clearTimeout(reconnectTimer);
      reconnectTimer = null;
      reconnecting = false;
    };

    const reconnect = () => {
      if (closed || reconnecting) return;
      reconnecting = true;
      sub?.close();
      // Capped fixed-delay reconnect on a real timer so close can interrupt it.
      reconnectTimer = setTimeout(() => {
        reconnectTimer = null;
        reconnecting = false;
        if (!closed) connect();
      }, RESUME_RECONNECT_DELAY_MS);
    };

    const reconcileLiveness = () => {
      void Effect.runPromise(
        Effect.gen(function* () {
          const status = yield* Effect.tryPromise({
            try: () => loadRuntimeStatus(runtime, piSessionId),
            catch: () => null,
          });
          if (closed) return;
          if (!status) {
            reconnect();
            return;
          }
          if (status.active) {
            commit(sessionId, (session) => ({
              ...session,
              piSessionId: status.piSessionId || session.piSessionId,
              contextUsage: runtimeContextUsage(status, session.contextUsage),
              status: session.status === "stopping" ? "stopping" : "running",
            }));
            reconnect();
            return;
          }
          // A reconnect armed by a prior onError must not fire connect() after
          // we've decided this runtime is idle — it would reopen an SSE against
          // a session we just idled.
          cancelReconnect();
          sub?.close();
          commitTranscript(sessionId);
          commit(sessionId, (session) =>
            session.status === "running" ||
            session.status === "starting" ||
            session.status === "stopping"
              ? {
                  ...settleTurn(session),
                  contextUsage: runtimeContextUsage(status, session.contextUsage),
                }
              : session,
          );
        }),
      );
    };

    const connect = () => {
      // (Re)connect past the highest seq already processed; the server answers
      // with a fresh snapshot frame first, so transcript content never depends
      // on the cursor.
      const after = lastSeq.get(sessionId) ?? 0;
      sub = subscribeRuntimeEvents(runtime, after, piSessionId, {
        onPayload: (payload) => {
          if (closed) return;
          lastPayloadAt = Date.now();
          if (payload.type === "status") applyStatusPayload(sessionId, payload);
          else if (payload.type === "snapshot") applySnapshotPayload(sessionId, payload);
          else if (payload.type === "progress") applyProgressPayload(sessionId, payload);
          else applyPiPayload(sessionId, payload);
        },
        onError: () => {
          if (closed) return;
          void reconcileLiveness();
        },
      });
    };

    connect();

    const watchdogFiber =
      RESUME_IDLE_RECONNECT_MS > 0
        ? (Effect.runFork(
            Effect.sync(() => {
              if (closed || Date.now() - lastPayloadAt < RESUME_IDLE_RECONNECT_MS) return;
              void reconcileLiveness();
            }).pipe(Effect.repeat(Schedule.spaced(RESUME_IDLE_RECONNECT_MS))),
          ) as never)
        : null;

    return {
      key: resumeConnectionKey(runtime, piSessionId),
      close: () => {
        closed = true;
        if (reconnectTimer !== null) clearTimeout(reconnectTimer);
        if (watchdogFiber) void Effect.runPromise(Fiber.interrupt(watchdogFiber));
        commitTranscript(sessionId);
        sub?.close();
      },
    };
  };

  return {
    bind: (next) => {
      binding = next;
    },
    unbind: () => {
      stopPoll();
      binding = null;
    },
    noteTurnAccepted: (sessionId, _assistantId, runtimeEventSeq) => {
      turnAcceptedAt.set(sessionId, Date.now());
      // A new turn supersedes any prior finish; drop the stamp so its own
      // eventual end owns the next grace window.
      turnFinishedAt.delete(sessionId);
      // Rewind the gate to 0 only on a genuine runtime restart — when the
      // runtime's reported seq is now below what we've already received. On a
      // steady-state turn the seq keeps climbing, so an unconditional rewind
      // would make the next reconnect re-apply the whole accumulated log. A
      // missing seq falls back to the old always-rewind behavior.
      const received = lastSeq.get(sessionId) ?? 0;
      if (runtimeEventSeq === undefined || runtimeEventSeq < received) {
        markRuntimeRestart(sessionId);
        commit(sessionId, (session) =>
          session.lastEventSeq === 0 ? session : { ...session, lastEventSeq: 0 },
        );
      }
    },
    noteReplayHydrated: (sessionId, committedSeq) => {
      lastSeq.set(sessionId, committedSeq ?? 0);
      commit(sessionId, (session) =>
        session.lastEventSeq === committedSeq
          ? session
          : { ...session, lastEventSeq: committedSeq },
      );
    },
    seedSnapshot: (sessionId, snapshot) => {
      const track = transcripts.get(sessionId);
      // Never downgrade a live transcript with a canonical projection of the
      // same pi session: the canonical form is revision 0 by construction.
      if (
        track &&
        !track.acceptAnyRevision &&
        track.state.snapshot.id === snapshot.id &&
        snapshot.revision < track.appliedRevision
      ) {
        commitTranscript(sessionId);
        return;
      }
      if (acceptSnapshot(sessionId, snapshot)) commitTranscript(sessionId);
    },
    prependTranscript: (sessionId, items) => {
      const track = transcripts.get(sessionId);
      if (!track || items.length === 0) return;
      const present = new Set(track.state.snapshot.transcript.map((item) => item.id));
      const older = items.filter((item) => !present.has(item.id));
      if (older.length === 0) return;
      track.state = {
        ...track.state,
        snapshot: {
          ...track.state.snapshot,
          transcript: [...older, ...track.state.snapshot.transcript],
        },
      };
      commitTranscript(sessionId);
    },
    reconcile: (sessions) => {
      const desired = new Map<
        SessionId,
        { connectionKey: string; piSessionId: string | null; lastEventSeq: number | undefined }
      >();
      for (const session of sessions) {
        if (shouldSubscribeRuntimeEvents(session.status)) {
          desired.set(session.id, {
            connectionKey: connectionKeyFor(session),
            piSessionId: session.piSessionId ?? null,
            lastEventSeq: session.lastEventSeq,
          });
        }
      }

      for (const [sessionId, attachment] of [...attachments]) {
        const want = desired.get(sessionId);
        const key = want ? resumeConnectionKey(want.connectionKey, want.piSessionId) : "";
        if (!want || attachment.key !== key) {
          attachment.close();
          attachments.delete(sessionId);
        }
      }

      pruneStaleSessionEntries(new Set(sessions.map((session) => session.id)));

      for (const [sessionId, want] of desired) {
        if (attachments.has(sessionId)) continue;
        // Seed the gate from the persisted cursor ONLY on a genuine first
        // attach (no live cursor yet) — e.g. a session restored from storage
        // as "running". A reopened attachment for an already-live session
        // keeps the in-memory high-water.
        if (!lastSeq.has(sessionId) && typeof want.lastEventSeq === "number") {
          lastSeq.set(sessionId, want.lastEventSeq);
        }
        attachments.set(sessionId, openAttachment(sessionId, want.connectionKey, want.piSessionId));
      }
    },
    flush: (sessionId) => commitTranscript(sessionId),
    pollNow: () => {
      stopPoll();
      if (!binding) return;
      // One immediate reconcile, then a steady interval. setInterval does not
      // fire an extra immediate iteration, so pollNow produces one fetch up front.
      void pollOnce();
      pollTimer = setInterval(() => void pollOnce(), RUNTIME_POLL_INTERVAL_MS);
    },
    closeAll: () => {
      stopPoll();
      publishRuntimeActivity([]);
      for (const attachment of attachments.values()) attachment.close();
      attachments.clear();
      // Workspace teardown: drop every per-session map so the app-lifetime
      // singleton doesn't retain one entry per session ever opened.
      lastSeq.clear();
      turnAcceptedAt.clear();
      turnFinishedAt.clear();
      connectionKeyOverrides.clear();
      transcripts.clear();
      adapterCaches.clear();
      pendingCommits.clear();
    },
    connectionKey: (sessionId) => connectionKeyOverrides.get(sessionId) ?? sessionId,
    seedConnectionKey: (sessionId, runtimeKey) => {
      // One-shot legacy seed: never clobber an override the poll already owns.
      if (!runtimeKey || runtimeKey === sessionId) return;
      if (connectionKeyOverrides.has(sessionId)) return;
      connectionKeyOverrides.set(sessionId, runtimeKey);
    },
  };
}

let singleton: SessionRuntimeController | null = null;

/** Lazy app-wide controller instance (one per page lifetime). */
export function sessionRuntimeController(): SessionRuntimeController {
  singleton ??= createSessionRuntimeController();
  return singleton;
}
