import { describe, expect, it } from "vitest";
import type { Session } from "./types";
import {
  resolveResumeRuntimeTarget,
  resolveRuntimeSessionId,
  runtimeCanHydrateCanonicalSession,
  runtimeIsActiveForPiSession,
} from "./engine-helpers";

const session = (patch: Partial<Session>): Session => ({
  id: "session-1",
  runtimeSessionId: "runtime-1",
  piSessionId: null,
  title: "Session",
  messages: [],
  status: "idle",
  error: "",
  input: "",
  ...patch,
});

describe("session engine helpers", () => {
  it("resolves runtime session ids with fallback locality", () => {
    expect(resolveRuntimeSessionId(session({ runtimeSessionId: "runtime-a" }), "fallback")).toBe(
      "runtime-a",
    );
    expect(resolveRuntimeSessionId(session({ runtimeSessionId: "" }), "fallback")).toBe("fallback");
    expect(resolveRuntimeSessionId(null, "fallback")).toBe("fallback");
  });

  it("matches active runtime status to the current pi session", () => {
    expect(runtimeIsActiveForPiSession({ active: true, piSessionId: "pi-1" }, "pi-1")).toBe(true);
    expect(runtimeIsActiveForPiSession({ running: true }, null)).toBe(true);
    expect(runtimeIsActiveForPiSession({ active: true, piSessionId: "other" }, "pi-1")).toBe(false);
    expect(runtimeIsActiveForPiSession(null, "pi-1")).toBe(false);
  });

  it("hydrates canonical replay only from the matching active runtime", () => {
    expect(runtimeCanHydrateCanonicalSession({ active: true, piSessionId: "pi-1" }, "pi-1")).toBe(
      true,
    );
    expect(runtimeCanHydrateCanonicalSession({ running: true, piSessionId: "pi-1" }, "pi-1")).toBe(
      false,
    );
    expect(runtimeCanHydrateCanonicalSession({ active: true, piSessionId: "other" }, "pi-1")).toBe(
      false,
    );
  });

  it("selects the active running or starting tab as the resume runtime target", () => {
    expect(
      resolveResumeRuntimeTarget(
        [session({ id: "a", status: "idle" }), session({ id: "b", status: "running" })],
        "a",
        "fallback",
      ),
    ).toBeNull();

    expect(
      resolveResumeRuntimeTarget(
        [
          session({
            id: "a",
            status: "starting",
            runtimeSessionId: "",
            lastEventSeq: 7,
          }),
        ],
        "a",
        "fallback",
      ),
    ).toEqual({ after: 7, runtimeSessionId: "fallback", sessionId: "a" });
  });
});
