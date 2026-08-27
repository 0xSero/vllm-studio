"use client";
import { Schema } from "effect";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useRef, useState, type ChangeEvent, type FormEvent } from "react";
import { useMountSubscription } from "@/hooks/use-mount-subscription";
import {
  ErrorText,
  JsonView,
  Page,
  Tabs,
  records,
  requestRecord,
  useJson,
  type Json,
  type RecordJson,
} from "./studio-core";
import { WorkspaceTools } from "./studio-tools";
import {
  acceptRuntimePayload,
  decodeCanonicalSession,
  decodeRuntimePayload,
  decodeRuntimeSnapshot,
  foldSessionEvent,
  foldSessionEvents,
  reconcileQueueEvent,
  mergeCanonicalRuntimeEvents,
  type FoldedMessage,
  type QueuedTurn,
  type RuntimeCursor,
} from "./studio-domain";

type Message = FoldedMessage;
const isString = Schema.is(Schema.String);
const SessionPreferenceSchema = Schema.Struct({
  title: Schema.optional(Schema.String),
  pinned: Schema.optional(Schema.Boolean),
  hidden: Schema.optional(Schema.Boolean),
});
const SessionPreferencesSchema = Schema.Record(Schema.String, SessionPreferenceSchema);
type SessionPreference = typeof SessionPreferenceSchema.Type;
type SessionPreferences = typeof SessionPreferencesSchema.Type;
const decodeSessionPreferences = Schema.decodeUnknownOption(SessionPreferencesSchema);
function jsonText(value: Json | undefined, fallback = ""): string {
  return isString(value) ? value : fallback;
}
const TurnResponseSchema = Schema.Struct({
  outcome: Schema.Literals(["accepted", "queued", "rejected"]),
  piSessionId: Schema.optional(Schema.NullOr(Schema.String)),
});
const decodeTurnResponse = Schema.decodeUnknownSync(TurnResponseSchema, {
  onExcessProperty: "preserve",
});

type ProjectOption = { id: string; name: string; path: string };
type SessionFilter = "active" | "archived" | "all";
type WorkspaceSelection = { cwd: string; projectId: string };
function selectedWorkspace(
  projects: ProjectOption[],
  selectedPath: string,
  requestedId: string,
): WorkspaceSelection {
  const requested = projects.find((project) => project.id === requestedId);
  const cwd = selectedPath || requested?.path || projects[0]?.path || "";
  return { cwd, projectId: projects.find((project) => project.path === cwd)?.id ?? requestedId };
}
function sessionListPath(filter: SessionFilter): `/api/${string}` {
  if (filter === "archived") return "/api/agent/sessions/all?archived=only";
  if (filter === "all") return "/api/agent/sessions/all?includeArchived=true";
  return "/api/agent/sessions/all?since=30d";
}
function modelThinkingLevels(model: RecordJson | undefined): string[] {
  return Array.isArray(model?.thinkingLevels) ? model.thinkingLevels.filter(isString) : ["auto"];
}
function WorkbenchActions({
  quick,
  sessionId,
  projectId,
}: {
  quick: boolean;
  sessionId: string;
  projectId: string;
}) {
  if (!quick)
    return (
      <Tabs
        items={[
          ["/agent/automations", "Goals & automations"],
          ["/configure#integrations", "Connectors"],
        ]}
      />
    );
  if (!sessionId || !globalThis.window?.localStudioDesktop) return null;
  return (
    <button
      onClick={() =>
        window.localStudioDesktop?.quickPanel.focusMainAndNavigate(projectId, sessionId)
      }
    >
      Continue in main window
    </button>
  );
}

export function Workbench({ quick = false }: { quick?: boolean }) {
  const searchParams = useSearchParams();
  const requestedProjectId = searchParams.get("project") ?? "";
  const requestedSessionId = searchParams.get("session") ?? "";
  const handedOffSession = useRef(false);
  const projectsState = useJson("/api/agent/projects");
  const modelsState = useJson("/api/agent/models");
  const providers = useJson("/api/agent/providers");
  const skillsState = useJson("/api/agent/skills");
  const templatesState = useJson("/api/agent/prompt-templates");
  const projects = records(projectsState.data, "projects").map((item) => ({
    id: jsonText(item.id),
    name: jsonText(item.name, jsonText(item.path, "Project")),
    path: jsonText(item.path),
  }));
  const [cwd, setCwd] = useState("");
  const workspace = selectedWorkspace(projects, cwd, requestedProjectId);
  const activeCwd = workspace.cwd;
  const activeProjectId = workspace.projectId;
  const [sessionFilter, setSessionFilter] = useState<SessionFilter>(() =>
    searchParams.has("archived") ? "archived" : "active",
  );
  const sessionsState = useJson(sessionListPath(sessionFilter));
  const [sessionId, setSessionId] = useState("");
  const [piSessionId, setPiSessionId] = useState<string | null>(null);
  const cursor = useRef<RuntimeCursor>({ received: 0, committed: 0 });
  const [streamVersion, setStreamVersion] = useState(0);
  const [messages, setMessages] = useState<Message[]>([]);
  const [queued, setQueued] = useState<QueuedTurn[]>([]);
  const [attachments, setAttachments] = useState<
    Array<{ id: string; name: string; dataUrl: string }>
  >([]);
  const [skills, setSkills] = useState<string[]>([]);
  const [templates, setTemplates] = useState<string[]>([]);
  const [thinking, setThinking] = useState("auto");
  const [prompt, setPrompt] = useState("");
  const [modelId, setModelId] = useState("");
  const [mode, setMode] = useState<"prompt" | "steer" | "follow_up">("prompt");
  const [fullTools, setFullTools] = useState(false);
  const [browserEnabled, setBrowserEnabled] = useState(false);
  const [remoteConsent, setRemoteConsent] = useState(false);
  const [error, setError] = useState("");
  const [sessionTitle, setSessionTitle] = useState("");
  const [pinned, setPinned] = useState(false);
  const [sessionPreferences, setSessionPreferences] = useState<SessionPreferences>({});
  const sessions = records(sessionsState.data, "sessions").sort((left, right) => {
    const leftPinned = sessionPreferences[jsonText(left.id)]?.pinned === true;
    const rightPinned = sessionPreferences[jsonText(right.id)]?.pinned === true;
    return Number(rightPinned) - Number(leftPinned);
  });
  useMountSubscription(() => {
    const apply = (value: Json) => {
      const decoded = decodeSessionPreferences(value);
      if (decoded._tag === "Some") setSessionPreferences(decoded.value);
    };
    if (window.localStudioDesktop) {
      void window.localStudioDesktop.loadSessionPrefs().then(apply);
      return;
    }
    const saved = localStorage.getItem("local-studio-session-preferences");
    if (!saved) return;
    try {
      apply(JSON.parse(saved));
    } catch {
      setError("Saved session preferences are invalid");
    }
  }, []);
  const models = records(modelsState.data, "models");
  const skillCatalogue = records(skillsState.data, "skills");
  const templateCatalogue = records(templatesState.data, "templates");
  const activeModel = modelId || jsonText(models[0]?.id, jsonText(models[0]?.name));
  const selectedModel = models.find((model) => jsonText(model.id) === activeModel);
  const thinkingLevels = modelThinkingLevels(selectedModel);
  useMountSubscription(() => {
    if (thinking !== "auto" && !thinkingLevels.includes(thinking)) setThinking("auto");
  }, [activeModel, thinking]);
  const composerSkills = skillCatalogue
    .filter((skill) => skills.includes(jsonText(skill.id)))
    .map((skill) => ({
      id: jsonText(skill.id),
      name: jsonText(skill.name),
      path: jsonText(skill.path),
      source: jsonText(skill.source),
    }));
  const composerTemplates = templateCatalogue
    .filter((template) => templates.includes(jsonText(template.id)))
    .map((template) => ({
      id: jsonText(template.id),
      name: jsonText(template.name),
      path: jsonText(template.path),
      source: jsonText(template.source),
    }));
  useMountSubscription(() => {
    setRemoteConsent(localStorage.getItem(`local-studio.remote-consent.${activeModel}`) === "1");
  }, [activeModel]);
  const createSession = () => {
    setSessionId(crypto.randomUUID());
    setPiSessionId(null);
    cursor.current = { received: 0, committed: 0 };
    setMessages([]);
  };
  const loadSession = async (id: string, projectPath = activeCwd) => {
    setSessionId(id);
    const preference = sessionPreferences[id];
    setSessionTitle(preference?.title ?? "");
    setPinned(preference?.pinned === true);
    try {
      const data = await requestRecord(
        `/api/agent/sessions/${encodeURIComponent(id)}?cwd=${encodeURIComponent(projectPath)}`,
      );
      const canonical = decodeCanonicalSession(data);
      const canonicalPiSessionId = canonical.meta?.piSessionId ?? null;
      setPiSessionId(canonicalPiSessionId);
      const runtimeData = await requestRecord(
        `/api/agent/runtime/status?sessionId=${encodeURIComponent(id)}${canonicalPiSessionId ? `&piSessionId=${encodeURIComponent(canonicalPiSessionId)}` : ""}`,
      );
      const runtime = decodeRuntimeSnapshot(runtimeData);
      cursor.current = { received: runtime.cursor, committed: runtime.cursor };
      setMessages(foldSessionEvents(mergeCanonicalRuntimeEvents(canonical.events, runtime.events)));
      setQueued([]);
      setStreamVersion((value) => value + 1);
    } catch (value) {
      setError(value instanceof Error ? value.message : String(value));
    }
  };
  useMountSubscription(() => {
    if (handedOffSession.current || !requestedSessionId || !activeCwd) return;
    handedOffSession.current = true;
    void loadSession(requestedSessionId, activeCwd);
  }, [requestedSessionId, activeCwd]);
  const archiveSession = async () => {
    if (!sessionId) return;
    try {
      await requestRecord(`/api/agent/sessions/${encodeURIComponent(sessionId)}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ cwd: activeCwd, archived: true }),
      });
      setSessionId("");
      setMessages([]);
      void sessionsState.reload();
    } catch (value) {
      setError(value instanceof Error ? value.message : String(value));
    }
  };
  const sessionPreference = (patch: SessionPreference) => {
    if (!sessionId) return;
    setSessionPreferences((current) => {
      const next = { ...current, [sessionId]: { ...current[sessionId], ...patch } };
      if (window.localStudioDesktop) void window.localStudioDesktop.saveSessionPrefs(next);
      else localStorage.setItem("local-studio-session-preferences", JSON.stringify(next));
      return next;
    });
  };
  const restoreSession = async () => {
    if (!sessionId) return;
    try {
      await requestRecord(`/api/agent/sessions/${encodeURIComponent(sessionId)}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ cwd: activeCwd, archived: false }),
      });
      void sessionsState.reload();
    } catch (value) {
      setError(value instanceof Error ? value.message : String(value));
    }
  };
  const exportSession = () => {
    const link = document.createElement("a");
    link.href = URL.createObjectURL(
      new Blob([messages.map((item) => `${item.role}: ${item.content}`).join("\n\n")], {
        type: "text/markdown",
      }),
    );
    link.download = `${sessionTitle || sessionId || "session"}.md`;
    link.click();
    URL.revokeObjectURL(link.href);
  };
  const control = async (endpoint: "abort" | "compact") => {
    if (!sessionId) return;
    try {
      await requestRecord(`/api/agent/${endpoint}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(
          endpoint === "compact"
            ? {
                sessionId,
                cwd: activeCwd,
                piSessionId,
                modelId: activeModel,
                thinkingLevel: "auto",
                toolAccess: fullTools ? "full" : "read_only",
                browserToolEnabled: browserEnabled,
                skills: composerSkills,
                promptTemplates: composerTemplates,
              }
            : { sessionId },
        ),
      });
    } catch (value) {
      setError(value instanceof Error ? value.message : String(value));
    }
  };
  const send = async (event: FormEvent) => {
    event.preventDefault();
    const content = prompt.trim();
    if (!content || !activeModel || !activeCwd) return;
    if (!remoteConsent) {
      setError("Confirm the selected destination custody disclosure before sending");
      return;
    }
    const id = sessionId || crypto.randomUUID();
    setSessionId(id);
    setPrompt("");
    setMessages((items) => [
      ...items,
      {
        id: `optimistic-${id}-${Date.now()}`,
        role: "user",
        content,
        blocks: [{ type: "text", text: content, value: content }],
      },
    ]);
    try {
      const result = await requestRecord("/api/agent/turn", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(
          (() => {
            const body: RecordJson = {
              sessionId: id,
              modelId: activeModel,
              message: content,
              images: attachments.flatMap((attachment) => {
                const separator = attachment.dataUrl.indexOf(",");
                const mime = attachment.dataUrl.slice(5, attachment.dataUrl.indexOf(";"));
                return separator > 0
                  ? [
                      {
                        type: "image",
                        data: attachment.dataUrl.slice(separator + 1),
                        mimeType: mime,
                      },
                    ]
                  : [];
              }),
              cwd: activeCwd,
              piSessionId,
              thinkingLevel: thinking,
              toolAccess: fullTools ? "full" : "read_only",
              browserToolEnabled: browserEnabled,
              skills: composerSkills,
              promptTemplates: composerTemplates,
            };
            if (mode === "steer") {
              body.mode = "steer";
              body.streamingBehavior = "steer";
            }
            if (mode === "follow_up") {
              body.mode = "follow_up";
              body.streamingBehavior = "followUp";
            }
            return body;
          })(),
        ),
      });
      const command = decodeTurnResponse(result);
      const outcome = command.outcome;
      if (outcome === "queued")
        setQueued((items) => [...items, { id: crypto.randomUUID(), text: content }]);
      if (outcome === "accepted") {
        cursor.current = { received: 0, committed: 0 };
        setQueued([]);
        setStreamVersion((value) => value + 1);
      }
      const canonical = command.piSessionId;
      if (canonical) setPiSessionId(canonical);
      setAttachments([]);
      setMessages((items) => [
        ...items,
        {
          id: `command-${id}-${Date.now()}`,
          role: "event",
          content: `Command ${outcome}`,
          blocks: [{ type: "event", text: `Command ${outcome}`, value: outcome }],
        },
      ]);
      void sessionsState.reload();
    } catch (value) {
      setError(value instanceof Error ? value.message : String(value));
    }
  };
  const attach = (event: ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(event.target.files ?? []);
    for (const file of files.slice(0, 4)) {
      if (!file.type.startsWith("image/") || file.size > 10 * 1024 * 1024) {
        setError(`${file.name} must be an image smaller than 10 MiB`);
        continue;
      }
      const reader = new FileReader();
      reader.onload = () => {
        const dataUrl = reader.result;
        if (isString(dataUrl))
          setAttachments((items) =>
            [...items, { id: crypto.randomUUID(), name: file.name, dataUrl }].slice(-4),
          );
      };
      reader.readAsDataURL(file);
    }
    event.target.value = "";
  };
  const mutateQueue = async (action: "promote" | "remove" | "replace", queuedTurn: QueuedTurn) => {
    const message = queuedTurn.text;
    try {
      const queueBody: RecordJson = {
        sessionId,
        piSessionId,
        cwd: activeCwd,
        modelId: activeModel,
        message,
        mode: "follow_up",
        queueAction: action,
        browserToolEnabled: browserEnabled,
        toolAccess: fullTools ? "full" : "read_only",
        skills: composerSkills,
        promptTemplates: composerTemplates,
      };
      if (action === "replace") queueBody.queueReplacement = prompt.trim() || message;
      await requestRecord("/api/agent/turn", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(queueBody),
      });
      setQueued((items) =>
        action === "remove"
          ? items.filter((item) => item.id !== queuedTurn.id)
          : action === "replace"
            ? items.map((item) =>
                item.id === queuedTurn.id ? { ...item, text: prompt.trim() || message } : item,
              )
            : [queuedTurn, ...items.filter((item) => item.id !== queuedTurn.id)],
      );
    } catch (value) {
      setError(value instanceof Error ? value.message : String(value));
    }
  };
  useMountSubscription(() => {
    if (!sessionId) return;
    const events = new EventSource(
      `/api/agent/runtime/events?sessionId=${encodeURIComponent(sessionId)}&after=${cursor.current.received}${piSessionId ? `&piSessionId=${encodeURIComponent(piSessionId)}` : ""}`,
    );
    events.onmessage = (event) => {
      try {
        const raw: Json = JSON.parse(event.data);
        const payload = decodeRuntimePayload(raw);
        if (!payload) return;
        const accepted = acceptRuntimePayload(cursor.current, payload);
        cursor.current = accepted.cursor;
        const acceptedEvent = accepted.event;
        if (acceptedEvent)
          setMessages((items) => foldSessionEvent(items, acceptedEvent, accepted.identity));
        if (acceptedEvent?.type === "queue_update")
          setQueued((items) => reconcileQueueEvent(items, acceptedEvent));
        if (payload.type === "status" && payload.phase === "idle") setQueued([]);
      } catch (value) {
        setError(value instanceof Error ? value.message : "Invalid runtime event");
      }
    };
    events.onerror = () => {
      events.close();
      window.setTimeout(() => setStreamVersion((value) => value + 1), 1200);
    };
    return () => events.close();
  }, [sessionId, piSessionId, streamVersion]);
  return (
    <Page
      title={quick ? "Quick panel" : "Workbench"}
      actions={<WorkbenchActions quick={quick} sessionId={sessionId} projectId={activeProjectId} />}
    >
      <p>
        Sessions and transcripts stay on this workstation. A selected remote provider or controller
        receives the prompt, attachments, selected skill/template text, and tool context. Browser,
        connector, write, or remote access starts only after the matching control is enabled and
        Send is pressed.
      </p>
      <ErrorText
        value={
          error ||
          projectsState.error ||
          modelsState.error ||
          providers.error ||
          sessionsState.error
        }
      />
      <div className="row">
        <select value={activeCwd} onChange={(event) => setCwd(event.target.value)}>
          {projects.map((project) => (
            <option key={project.id} value={project.path}>
              {project.name}
            </option>
          ))}
        </select>
        <select value={activeModel} onChange={(event) => setModelId(event.target.value)}>
          {models.map((model) => (
            <option key={jsonText(model.id)} value={jsonText(model.id)}>
              {jsonText(model.name, jsonText(model.id))}
            </option>
          ))}
        </select>
        <select
          value={mode}
          onChange={(event) => {
            const value = event.target.value;
            if (value === "prompt" || value === "steer" || value === "follow_up") setMode(value);
          }}
        >
          <option value="prompt">Prompt / queue</option>
          <option value="steer">Steer active turn</option>
          <option value="follow_up">Follow up</option>
        </select>
        <label>
          <input
            type="checkbox"
            checked={fullTools}
            onChange={(event) => setFullTools(event.target.checked)}
          />
          Allow writes
        </label>
        <label>
          <input
            type="checkbox"
            checked={browserEnabled}
            onChange={(event) => setBrowserEnabled(event.target.checked)}
          />
          Browser
        </label>
        <select
          value={thinking}
          onChange={(event) => setThinking(event.target.value)}
          aria-label="Thinking level"
        >
          {["auto", ...thinkingLevels.filter((level) => level !== "auto")].map((level) => (
            <option key={level} value={level}>
              Thinking: {level}
            </option>
          ))}
        </select>
        <input type="file" accept="image/*" multiple onChange={attach} aria-label="Attach images" />
      </div>
      <div className="row">
        {skillCatalogue.map((skill) => {
          const id = jsonText(skill.id);
          const name = jsonText(skill.name, id);
          return (
            <label key={id}>
              <input
                type="checkbox"
                checked={skills.includes(id)}
                onChange={() =>
                  setSkills((items) =>
                    items.includes(id) ? items.filter((item) => item !== id) : [...items, id],
                  )
                }
              />
              Skill: {name}
            </label>
          );
        })}
        {templateCatalogue.map((template) => {
          const id = jsonText(template.id);
          const name = jsonText(template.name, id);
          return (
            <button
              key={id}
              onClick={() =>
                setTemplates((items) =>
                  items.includes(id) ? items.filter((item) => item !== id) : [...items, id],
                )
              }
            >
              Template: {name}
            </button>
          );
        })}
        {attachments.map((attachment) => (
          <span key={attachment.id}>
            {attachment.name}
            <button
              type="button"
              aria-label={`Remove ${attachment.name}`}
              onClick={() =>
                setAttachments((items) => items.filter((item) => item.id !== attachment.id))
              }
            >
              Remove
            </button>
          </span>
        ))}
      </div>
      <label>
        <input
          type="checkbox"
          checked={remoteConsent}
          onChange={(event) => {
            const allowed = event.target.checked;
            setRemoteConsent(allowed);
            localStorage.setItem(`local-studio.remote-consent.${activeModel}`, allowed ? "1" : "0");
          }}
        />
        On Send, {activeModel || "the selected destination"} receives this prompt, attachments,
        loaded skill/template paths, and enabled tool context. It controls that copy under its own
        retention policy.
      </label>
      <div className="workbench">
        <aside className="panel">
          <div className="row">
            <select
              aria-label="Session filter"
              value={sessionFilter}
              onChange={(event) => {
                const value = event.target.value;
                if (value === "active" || value === "archived" || value === "all")
                  setSessionFilter(value);
              }}
            >
              <option value="active">Active sessions</option>
              <option value="archived">Archived sessions</option>
              <option value="all">All sessions</option>
            </select>
            <button onClick={createSession}>New</button>
            <button onClick={archiveSession} disabled={!sessionId}>
              Archive
            </button>
            <button onClick={restoreSession} disabled={!sessionId}>
              Restore
            </button>
            <button
              onClick={() => {
                const title = window.prompt("Session name", sessionTitle);
                if (title !== null) {
                  setSessionTitle(title);
                  sessionPreference({ title });
                }
              }}
              disabled={!sessionId}
            >
              Rename
            </button>
            <button
              onClick={() => {
                setPinned((value) => {
                  sessionPreference({ pinned: !value });
                  return !value;
                });
              }}
              disabled={!sessionId}
            >
              {pinned ? "Unpin" : "Pin"}
            </button>
            <button onClick={exportSession} disabled={!sessionId}>
              Export
            </button>
            <button onClick={archiveSession} disabled={!sessionId}>
              Archive (deletion disabled)
            </button>
          </div>
          {sessions.map((session) => (
            <button
              className="session"
              key={jsonText(session.id)}
              onClick={() => loadSession(jsonText(session.id), jsonText(session.cwd, activeCwd))}
            >
              {sessionPreferences[jsonText(session.id)]?.title ??
                jsonText(session.firstUserMessage, jsonText(session.title, jsonText(session.id)))}
            </button>
          ))}
          <h2>Providers</h2>
          <JsonView value={providers.data} />
        </aside>
        <article className="chat">
          {messages.length ? (
            messages.map((message) => (
              <div key={message.id} className={message.role}>
                <b>{message.role}</b>
                <p>{message.content}</p>
                {message.blocks
                  .filter((block) => block.type !== "text" && !block.text)
                  .map((block, index) => (
                    <pre key={`${message.id}-${index}`}>{JSON.stringify(block.value, null, 2)}</pre>
                  ))}
              </div>
            ))
          ) : (
            <p>Start a private local task.</p>
          )}
          <div className="row">
            <button onClick={() => control("abort")}>Abort</button>
            <button onClick={() => control("compact")}>Compact</button>
          </div>
          {queued.length ? (
            <section>
              <h3>Queued follow-ups</h3>
              {queued.map((item) => (
                <div className="item" key={item.id}>
                  <span>{item.text}</span>
                  <button onClick={() => mutateQueue("promote", item)}>Promote</button>
                  <button onClick={() => mutateQueue("replace", item)}>Replace with draft</button>
                  <button onClick={() => mutateQueue("remove", item)}>Remove</button>
                </div>
              ))}
            </section>
          ) : null}
          <form onSubmit={send} className="row">
            <textarea
              value={prompt}
              onChange={(event) => setPrompt(event.target.value)}
              placeholder="Ask the local agent…"
            />
            <button disabled={!remoteConsent}>Send</button>
          </form>
        </article>
      </div>
      <WorkspaceTools cwd={activeCwd} />
    </Page>
  );
}

export function Automations() {
  const [piSessionId, setPiSessionId] = useState("");
  const automations = useJson("/api/agent/automations");
  const goal = useJson(`/api/agent/goal?piSessionId=${encodeURIComponent(piSessionId)}`);
  const [text, setText] = useState("");
  const [message, setMessage] = useState("");
  const [automationId, setAutomationId] = useState("");
  const [name, setName] = useState("");
  const [automationPrompt, setAutomationPrompt] = useState("");
  const [model, setModel] = useState("");
  const [cwd, setCwd] = useState("");
  const [scheduleKind, setScheduleKind] = useState<"interval" | "daily" | "weekly">("daily");
  const [minutes, setMinutes] = useState("60");
  const [time, setTime] = useState("08:00");
  const [day, setDay] = useState("1");
  const run = async (path: `/api/${string}`, init?: RequestInit) => {
    try {
      await requestRecord(path, init);
      setMessage("Saved locally");
      void automations.reload();
      void goal.reload();
    } catch (value) {
      setMessage(value instanceof Error ? value.message : String(value));
    }
  };
  const json = (value: RecordJson, method = "POST"): RequestInit => ({
    method,
    headers: { "content-type": "application/json" },
    body: JSON.stringify(value),
  });
  const schedule: RecordJson =
    scheduleKind === "interval"
      ? { kind: "interval", minutes: Number(minutes) }
      : scheduleKind === "weekly"
        ? { kind: "weekly", day: Number(day), time }
        : { kind: "daily", time };
  const draft: RecordJson = { name, prompt: automationPrompt, modelId: model, cwd, schedule };
  const saveAutomation = () =>
    run(
      automationId
        ? `/api/agent/automations/${encodeURIComponent(automationId)}`
        : "/api/agent/automations",
      json(draft, automationId ? "PATCH" : "POST"),
    );
  return (
    <Page title="Goals & automations" actions={<Link href="/agent">Workbench</Link>}>
      <p>
        Review and explicitly run scheduled local work. Automations use the same provider,
        connector, consent, and filesystem boundaries as Workbench.
      </p>
      <ErrorText value={message || automations.error || goal.error} />
      <div className="grid">
        <article>
          <h2>Goal</h2>
          <div className="row">
            <input
              value={piSessionId}
              onChange={(event) => setPiSessionId(event.target.value)}
              placeholder="Runtime session id"
            />
            <input
              value={text}
              onChange={(event) => setText(event.target.value)}
              placeholder="Goal"
            />
            <button
              onClick={() =>
                run(
                  `/api/agent/goal?piSessionId=${encodeURIComponent(piSessionId)}`,
                  json({ objective: text }, "PUT"),
                )
              }
            >
              Set
            </button>
            <button
              onClick={() =>
                run(`/api/agent/goal?piSessionId=${encodeURIComponent(piSessionId)}`, {
                  method: "DELETE",
                })
              }
            >
              Clear
            </button>
          </div>
          <JsonView value={goal.data} />
        </article>
        <article>
          <h2>Automations</h2>
          <div className="row">
            <input
              value={name}
              onChange={(event) => setName(event.target.value)}
              placeholder="Name"
            />
            <input
              value={automationPrompt}
              onChange={(event) => setAutomationPrompt(event.target.value)}
              placeholder="Prompt"
            />
            <input
              value={model}
              onChange={(event) => setModel(event.target.value)}
              placeholder="Model id"
            />
            <input
              value={cwd}
              onChange={(event) => setCwd(event.target.value)}
              placeholder="Working directory"
            />
          </div>
          <div className="row">
            <select
              value={scheduleKind}
              onChange={(event) => {
                const value = event.target.value;
                if (value === "interval" || value === "daily" || value === "weekly")
                  setScheduleKind(value);
              }}
            >
              <option value="interval">Interval</option>
              <option value="daily">Daily</option>
              <option value="weekly">Weekly</option>
            </select>
            {scheduleKind === "interval" ? (
              <input
                value={minutes}
                onChange={(event) => setMinutes(event.target.value)}
                aria-label="Interval minutes"
              />
            ) : (
              <input type="time" value={time} onChange={(event) => setTime(event.target.value)} />
            )}
            {scheduleKind === "weekly" ? (
              <input
                min="0"
                max="6"
                type="number"
                value={day}
                onChange={(event) => setDay(event.target.value)}
                aria-label="Weekday 0 through 6"
              />
            ) : null}
            <button onClick={saveAutomation}>
              {automationId ? "Save automation" : "Create automation"}
            </button>
            <button
              onClick={() => {
                setAutomationId("");
                setName("");
                setAutomationPrompt("");
              }}
            >
              New
            </button>
          </div>
          {records(automations.data, "automations").map((item) => {
            const id = jsonText(item.id);
            return (
              <div className="item" key={id}>
                <span>{jsonText(item.name, id)}</span>
                <button
                  onClick={() => {
                    setAutomationId(id);
                    setName(jsonText(item.name));
                    setAutomationPrompt(jsonText(item.prompt));
                    setModel(jsonText(item.modelId));
                    setCwd(jsonText(item.cwd));
                  }}
                >
                  Edit
                </button>
                <button
                  onClick={() =>
                    run(
                      `/api/agent/automations/${encodeURIComponent(id)}`,
                      json({ status: item.status === "paused" ? "active" : "paused" }, "PATCH"),
                    )
                  }
                >
                  {item.status === "paused" ? "Resume" : "Pause"}
                </button>
                <button
                  onClick={() =>
                    run(`/api/agent/automations/${encodeURIComponent(id)}/run`, { method: "POST" })
                  }
                >
                  Run now
                </button>
                <button
                  onClick={() =>
                    run(`/api/agent/automations/${encodeURIComponent(id)}`, { method: "DELETE" })
                  }
                >
                  Delete
                </button>
              </div>
            );
          })}
          <JsonView value={automations.data} />
        </article>
      </div>
    </Page>
  );
}
