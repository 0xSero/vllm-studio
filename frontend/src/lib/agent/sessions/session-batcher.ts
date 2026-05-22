// Coalesces multiple `updateSession` calls for a single session id into ONE
// functional patch applied to the real updater. This is what lets us commit a
// full animation frame's worth of streaming events as a single React render,
// matching the Codex desktop app's `frameTextDeltaQueue`/`applyFrameTextDeltas`
// model.
//
// Usage:
//   const batched = createSessionBatcher(realUpdateSession);
//   batched.run(sessionId, (update) => {
//     // ...call any code that uses `update` (which has the same signature as
//     // the real updateSession). All patches composed in order. Other session
//     // ids pass straight through to the real updater.
//   });
//
// Inside the `run` callback every `update(sessionId, patcher)` for the target
// session is queued. When the callback returns, the queued patchers are
// composed into a single functional patch and applied via the real updater
// (one React commit). Updates for other session ids are forwarded unchanged.

import type { Session, SessionId } from "./types";

type UpdateSession = (sessionId: SessionId, patch: (session: Session) => Session) => void;

export type SessionBatcher = {
  /** Run `body` with a scoped `update` that batches writes for `sessionId`. */
  run: (sessionId: SessionId, body: (update: UpdateSession) => void) => void;
};

export function createSessionBatcher(real: UpdateSession): SessionBatcher {
  return {
    run(sessionId, body) {
      const queued: Array<(session: Session) => Session> = [];
      const scoped: UpdateSession = (id, patch) => {
        if (id === sessionId) {
          queued.push(patch);
          return;
        }
        real(id, patch);
      };
      try {
        body(scoped);
      } finally {
        if (queued.length > 0) {
          real(sessionId, (session) => {
            let next = session;
            for (const patch of queued) next = patch(next);
            return next;
          });
        }
      }
    },
  };
}
