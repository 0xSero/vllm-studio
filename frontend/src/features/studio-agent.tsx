"use client";
import Link from "next/link";
import { useState, type FormEvent } from "react";
import { useMountSubscription } from "@/hooks/use-mount-subscription";
import {
  ErrorText,
  JsonView,
  Page,
  Tabs,
  records,
  request,
  useJson,
  type Json,
  type RecordJson,
} from "./studio-core";

type Message = { role: "user" | "assistant" | "event"; content: string };

function objectValue(value: Json | undefined): RecordJson | null {
  return value && typeof value === "object" && !Array.isArray(value) ? value : null;
}
function readableEvent(event: RecordJson): string {
  const value = event.message ?? event.content ?? event.text ?? event.type;
  return typeof value === "string" ? value : JSON.stringify(event);
}

function Tools({ cwd }: { cwd: string }) {
  const [path, setPath] = useState("");
  const [command, setCommand] = useState("git status");
  const [url, setUrl] = useState("http://localhost:3000");
  const [output, setOutput] = useState<Json | null>(null);
  const [error, setError] = useState("");
  const run = async (endpoint: `/api/${string}`, init?: RequestInit) => {
    try {
      setOutput(await request<Json>(endpoint, init));
      setError("");
    } catch (value) {
      setError(value instanceof Error ? value.message : String(value));
    }
  };
  const body = (value: RecordJson): RequestInit => ({
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(value),
  });
  return (
    <section className="tools">
      <h2>Local tools</h2>
      <p>
        Read access is local. Terminal, file writes, browser input, and Git mutations require an
        explicit action here.
      </p>
      <div className="row">
        <input
          value={path}
          onChange={(event) => setPath(event.target.value)}
          placeholder="Relative file path"
        />
        <button
          onClick={() =>
            run(`/api/agent/fs?cwd=${encodeURIComponent(cwd)}&path=${encodeURIComponent(path)}`)
          }
        >
          Files
        </button>
        <button
          onClick={() =>
            run(`/api/agent/fs/search?cwd=${encodeURIComponent(cwd)}&q=${encodeURIComponent(path)}`)
          }
        >
          Search
        </button>
        <button onClick={() => run(`/api/agent/git?cwd=${encodeURIComponent(cwd)}`)}>Git</button>
      </div>
      <div className="row">
        <input value={command} onChange={(event) => setCommand(event.target.value)} />
        <button
          onClick={() =>
            run(`/api/agent/terminal?cwd=${encodeURIComponent(cwd)}`, body({ command }))
          }
        >
          Run locally
        </button>
      </div>
      <div className="row">
        <input value={url} onChange={(event) => setUrl(event.target.value)} />
        <button onClick={() => run("/api/agent/browser/state")}>Browser state</button>
        <button onClick={() => run("/api/agent/browser/navigate", body({ url }))}>
          Navigate local browser
        </button>
      </div>
      <ErrorText value={error} />
      {output !== null ? <JsonView value={output} /> : null}
    </section>
  );
}

export function Workbench({ quick = false }: { quick?: boolean }) {
  const projectsState = useJson<RecordJson>("/api/agent/projects");
  const modelsState = useJson<RecordJson>("/api/agent/models");
  const providers = useJson<RecordJson>("/api/agent/providers");
  const projects = records(projectsState.data, "projects").map((item) => ({
    id: String(item.id ?? ""),
    name: String(item.name ?? item.path ?? "Project"),
    path: String(item.path ?? ""),
  }));
  const [cwd, setCwd] = useState("");
  const activeCwd = cwd || projects[0]?.path || "";
  const sessionsState = useJson<RecordJson>(`/api/agent/sessions/all?since=30d`);
  const [sessionId, setSessionId] = useState("");
  const [piSessionId, setPiSessionId] = useState<string | null>(null);
  const [eventCursor, setEventCursor] = useState(0);
  const [messages, setMessages] = useState<Message[]>([]);
  const [prompt, setPrompt] = useState("");
  const [modelId, setModelId] = useState("");
  const [mode, setMode] = useState<"prompt" | "steer" | "follow_up">("prompt");
  const [fullTools, setFullTools] = useState(false);
  const [browserEnabled, setBrowserEnabled] = useState(false);
  const [error, setError] = useState("");
  const sessions = records(sessionsState.data, "sessions");
  const models = records(modelsState.data, "models");
  const activeModel = modelId || String(models[0]?.id ?? models[0]?.name ?? "");
  const createSession = () => {
    setSessionId(crypto.randomUUID());
    setPiSessionId(null);
    setEventCursor(0);
    setMessages([]);
  };
  const loadSession = async (id: string, projectPath = activeCwd) => {
    setSessionId(id);
    try {
      const data = await request<RecordJson>(
        `/api/agent/sessions/${encodeURIComponent(id)}?cwd=${encodeURIComponent(projectPath)}`,
      );
      const meta = objectValue(data.meta);
      const canonical = meta?.piSessionId;
      setPiSessionId(typeof canonical === "string" ? canonical : null);
      setEventCursor(typeof data.cursor === "number" ? data.cursor : 0);
      setMessages(
        records(data, "events").map((entry) => ({ role: "event", content: readableEvent(entry) })),
      );
    } catch (value) {
      setError(value instanceof Error ? value.message : String(value));
    }
  };
  const archiveSession = async () => {
    if (!sessionId) return;
    try {
      await request<RecordJson>(`/api/agent/sessions/${encodeURIComponent(sessionId)}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ cwd: activeCwd, archived: true }),
      });
      setSessionId("");
      setMessages([]);
      sessionsState.reload();
    } catch (value) {
      setError(value instanceof Error ? value.message : String(value));
    }
  };
  const control = async (endpoint: "abort" | "compact") => {
    if (!sessionId) return;
    try {
      await request<RecordJson>(`/api/agent/${endpoint}`, {
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
    setMessages((items) => [...items, { role: "user", content }]);
    try {
      const result = await request<RecordJson>("/api/agent/turn", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          sessionId: id,
          modelId: activeModel,
          message: content,
          images: [],
          cwd: activeCwd,
          piSessionId,
          toolAccess: fullTools ? "full" : "read_only",
          browserToolEnabled: browserEnabled,
          skills: [],
          promptTemplates: [],
          mode,
          streamingBehavior: mode === "steer" ? "steer" : "followUp",
        }),
      });
      setMessages((items) => [...items, { role: "event", content: JSON.stringify(result) }]);
      sessionsState.reload();
    } catch (value) {
      setError(value instanceof Error ? value.message : String(value));
    }
  };
  useMountSubscription(() => {
    if (!sessionId) return;
    const events = new EventSource(
      `/api/agent/runtime/events?sessionId=${encodeURIComponent(sessionId)}&after=${eventCursor}`,
    );
    events.onmessage = (event) => {
      try {
        const parsed = JSON.parse(event.data) as RecordJson;
        const seq = parsed.seq ?? parsed.eventSeq;
        if (typeof seq === "number") setEventCursor((current) => Math.max(current, seq));
        setMessages((items) => [...items, { role: "event", content: readableEvent(parsed) }]);
      } catch {
        setMessages((items) => [...items, { role: "event", content: event.data }]);
      }
    };
    events.onerror = () => events.close();
    return () => events.close();
  }, [sessionId]);
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
        Sessions, transcripts, tools, and execution stay on this workstation. Enable providers,
        connectors, browser control, or write access only when the task needs them.
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
            <option key={String(model.id)} value={String(model.id)}>
              {String(model.name ?? model.id)}
            </option>
          ))}
        </select>
        <select value={mode} onChange={(event) => setMode(event.target.value as typeof mode)}>
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
      </div>
      <div className="workbench">
        <aside className="panel">
          <div className="row">
            <button onClick={createSession}>New</button>
            <button onClick={archiveSession} disabled={!sessionId}>
              Archive
            </button>
          </div>
          {sessions.map((session) => (
            <button
              className="session"
              key={String(session.id)}
              onClick={() => loadSession(String(session.id), String(session.cwd ?? activeCwd))}
            >
              {String(session.firstUserMessage ?? session.title ?? session.id)}
            </button>
          ))}
          <h2>Providers</h2>
          <JsonView value={providers.data} />
        </aside>
        <article className="chat">
          {messages.length ? (
            messages.map((message, index) => (
              <div key={index} className={message.role}>
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
      <Tools cwd={activeCwd} />
    </Page>
  );
}

export function Automations() {
  const [piSessionId, setPiSessionId] = useState("");
  const automations = useJson<RecordJson>("/api/agent/automations");
  const goal = useJson<RecordJson>(
    `/api/agent/goal?piSessionId=${encodeURIComponent(piSessionId)}`,
  );
  const [text, setText] = useState("");
  const [message, setMessage] = useState("");
  const run = async (path: `/api/${string}`, init?: RequestInit) => {
    try {
      await request<RecordJson>(path, init);
      setMessage("Saved locally");
      automations.reload();
      goal.reload();
    } catch (value) {
      setMessage(value instanceof Error ? value.message : String(value));
    }
  };
  const json = (value: RecordJson, method = "POST"): RequestInit => ({
    method,
    headers: { "content-type": "application/json" },
    body: JSON.stringify(value),
  });
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
          {records(automations.data, "automations").map((item) => {
            const id = String(item.id ?? "");
            return (
              <div className="item" key={id}>
                <span>{String(item.name ?? id)}</span>
                <button
                  onClick={() =>
                    run(`/api/agent/automations/${encodeURIComponent(id)}/run`, { method: "POST" })
                  }
                >
                  Run now
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
