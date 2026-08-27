"use client";
import { Schema } from "effect";
import Link from "next/link";
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
  foldSessionEvent,
  foldSessionEvents,
  type FoldedMessage,
  type RuntimeCursor,
} from "./studio-domain";

type Message = FoldedMessage;
const isString = Schema.is(Schema.String);
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

export function Workbench({ quick = false }: { quick?: boolean }) {
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
  const activeCwd = cwd || projects[0]?.path || "";
  const sessionsState = useJson(`/api/agent/sessions/all?since=30d`);
  const [sessionId, setSessionId] = useState("");
  const [piSessionId, setPiSessionId] = useState<string | null>(null);
  const cursor = useRef<RuntimeCursor>({ received: 0, committed: 0 });
  const [streamVersion, setStreamVersion] = useState(0);
  const [messages, setMessages] = useState<Message[]>([]);
  const [queued, setQueued] = useState<string[]>([]);
  const [attachments, setAttachments] = useState<Array<{ name: string; dataUrl: string }>>([]);
  const [skills, setSkills] = useState<string[]>([]);
  const [templates, setTemplates] = useState<string[]>([]);
  const [thinking, setThinking] = useState("auto");
  const [prompt, setPrompt] = useState("");
  const [modelId, setModelId] = useState("");
  const [mode, setMode] = useState<"prompt" | "steer" | "follow_up">("prompt");
  const [fullTools, setFullTools] = useState(false);
  const [browserEnabled, setBrowserEnabled] = useState(false);
  const [error, setError] = useState("");
  const [sessionTitle, setSessionTitle] = useState("");
  const [pinned, setPinned] = useState(false);
  const sessions = records(sessionsState.data, "sessions");
  const models = records(modelsState.data, "models");
  const activeModel = modelId || jsonText(models[0]?.id, jsonText(models[0]?.name));
  const createSession = () => {
    setSessionId(crypto.randomUUID());
    setPiSessionId(null);
    cursor.current = { received: 0, committed: 0 };
    setMessages([]);
  };
  const loadSession = async (id: string, projectPath = activeCwd) => {
    setSessionId(id);
    try {
      const data = await requestRecord(
        `/api/agent/sessions/${encodeURIComponent(id)}?cwd=${encodeURIComponent(projectPath)}`,
      );
      const canonical = decodeCanonicalSession(data);
      setPiSessionId(canonical.meta?.piSessionId ?? null);
      cursor.current = { received: 0, committed: 0 };
      setMessages(foldSessionEvents(canonical.events));
      setQueued([]);
      setStreamVersion((value) => value + 1);
    } catch (value) {
      setError(value instanceof Error ? value.message : String(value));
    }
  };
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
  const sessionPreference = (patch: RecordJson) => {
    if (!sessionId) return;
    const key = `local-studio.session.${sessionId}`;
    const previous = localStorage.getItem(key);
    let value: RecordJson = {};
    if (previous) {
      try {
        const parsed: Json = JSON.parse(previous);
        value = records({ parsed }, "parsed")[0] ?? {};
      } catch {
        value = {};
      }
    }
    localStorage.setItem(key, JSON.stringify({ ...value, ...patch }));
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
                skills: [],
                promptTemplates: [],
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
    const id = sessionId || crypto.randomUUID();
    setSessionId(id);
    setPrompt("");
    setMessages((items) => [...items, { id: crypto.randomUUID(), role: "user", content }]);
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
              skills: skills.map((name) => ({ id: name, name })),
              promptTemplates: templates.map((name) => ({ id: name, name })),
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
      if (outcome === "queued") setQueued((items) => [...items, content]);
      else setQueued([]);
      const canonical = command.piSessionId;
      if (canonical) setPiSessionId(canonical);
      setAttachments([]);
      setMessages((items) => [
        ...items,
        { id: crypto.randomUUID(), role: "event", content: `Command ${outcome}` },
      ]);
      void sessionsState.reload();
    } catch (value) {
      setError(value instanceof Error ? value.message : String(value));
    }
  };
  const attach = (event: ChangeEvent<HTMLInputElement>) => {
    for (const file of Array.from(event.target.files ?? []).slice(0, 4)) {
      const reader = new FileReader();
      reader.onload = () => {
        const dataUrl = reader.result;
        if (isString(dataUrl))
          setAttachments((items) => [...items, { name: file.name, dataUrl }].slice(-4));
      };
      reader.readAsDataURL(file);
    }
  };
  const mutateQueue = async (action: "promote" | "remove" | "replace", message: string) => {
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
        skills: [],
        promptTemplates: [],
      };
      if (action === "replace") queueBody.queueReplacement = prompt.trim() || message;
      await requestRecord("/api/agent/turn", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(queueBody),
      });
      setQueued((items) =>
        action === "remove"
          ? items.filter((item) => item !== message)
          : action === "replace"
            ? items.map((item) => (item === message ? prompt.trim() || message : item))
            : [message, ...items.filter((item) => item !== message)],
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
        if (acceptedEvent) setMessages((items) => foldSessionEvent(items, acceptedEvent));
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
      actions={
        !quick ? (
          <Tabs
            items={[
              ["/agent/automations", "Goals & automations"],
              ["/configure#integrations", "Connectors"],
            ]}
          />
        ) : undefined
      }
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
          <option value="auto">Thinking: auto</option>
          <option value="off">Off</option>
          <option value="low">Low</option>
          <option value="medium">Medium</option>
          <option value="high">High</option>
        </select>
        <input type="file" accept="image/*" multiple onChange={attach} aria-label="Attach images" />
      </div>
      <div className="row">
        {records(skillsState.data, "skills").map((skill) => {
          const name = jsonText(skill.name, jsonText(skill.id));
          return (
            <label key={name}>
              <input
                type="checkbox"
                checked={skills.includes(name)}
                onChange={() =>
                  setSkills((items) =>
                    items.includes(name) ? items.filter((item) => item !== name) : [...items, name],
                  )
                }
              />
              Skill: {name}
            </label>
          );
        })}
        {records(templatesState.data, "templates").map((template) => {
          const name = jsonText(template.name, jsonText(template.id));
          return (
            <button
              key={name}
              onClick={() =>
                setTemplates((items) =>
                  items.includes(name) ? items.filter((item) => item !== name) : [...items, name],
                )
              }
            >
              Template: {name}
            </button>
          );
        })}
        {attachments.map((attachment) => (
          <span key={attachment.name}>{attachment.name}</span>
        ))}
      </div>
      <div className="workbench">
        <aside className="panel">
          <div className="row">
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
            <button
              onClick={() => {
                sessionPreference({ hidden: true });
                setSessionId("");
                setMessages([]);
              }}
              disabled={!sessionId}
            >
              Delete locally
            </button>
          </div>
          {sessions.map((session) => (
            <button
              className="session"
              key={jsonText(session.id)}
              onClick={() => loadSession(jsonText(session.id), jsonText(session.cwd, activeCwd))}
            >
              {jsonText(session.firstUserMessage, jsonText(session.title, jsonText(session.id)))}
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
                <div className="item" key={item}>
                  <span>{item}</span>
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
            <button>Send</button>
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
