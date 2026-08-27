"use client";
import { Schema } from "effect";
import { useRef, useState } from "react";
import { useMountSubscription } from "@/hooks/use-mount-subscription";
import {
  ErrorText,
  JsonView,
  request,
  requestRecord,
  type Json,
  type RecordJson,
} from "./studio-core";

const FileResponseSchema = Schema.Struct({ content: Schema.String });
const PtyOpenResponseSchema = Schema.Struct({
  id: Schema.String,
  replay: Schema.optional(Schema.String),
});
const decodeFileResponse = Schema.decodeUnknownSync(FileResponseSchema, {
  onExcessProperty: "preserve",
});
const decodePtyOpenResponse = Schema.decodeUnknownSync(PtyOpenResponseSchema, {
  onExcessProperty: "preserve",
});

function post(value: RecordJson): RequestInit {
  return {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(value),
  };
}
function FileTools({ cwd }: { cwd: string }) {
  const [path, setPath] = useState("");
  const [content, setContent] = useState("");
  const [line, setLine] = useState("1");
  const [comment, setComment] = useState("");
  const [output, setOutput] = useState<Json | null>(null);
  const [error, setError] = useState("");
  const query = `cwd=${encodeURIComponent(cwd)}&path=${encodeURIComponent(path)}`;
  const run = async (operation: () => Promise<Json>) => {
    try {
      setOutput(await operation());
      setError("");
    } catch (value) {
      setError(value instanceof Error ? value.message : String(value));
    }
  };
  const open = () =>
    run(async () => {
      const value = await requestRecord(`/api/agent/fs/file?${query}`);
      setContent(decodeFileResponse(value).content);
      return value;
    });
  return (
    <article>
      <h3>Files, preview & comments</h3>
      <div className="row">
        <input
          value={path}
          onChange={(event) => setPath(event.target.value)}
          placeholder="Relative path"
        />
        <button onClick={open}>Open</button>
        <button
          onClick={() =>
            run(() =>
              request(
                `/api/agent/fs/search?cwd=${encodeURIComponent(cwd)}&q=${encodeURIComponent(path)}`,
              ),
            )
          }
        >
          Search
        </button>
        <a href={`/api/agent/fs/raw?${query}`} target="_blank" rel="noreferrer">
          Raw preview
        </a>
      </div>
      <textarea
        value={content}
        onChange={(event) => setContent(event.target.value)}
        placeholder="File content"
      />
      <button
        onClick={() =>
          run(() => request(`/api/agent/fs/file?${query}`, { ...post({ content }), method: "PUT" }))
        }
      >
        Save file
      </button>
      <div className="row">
        <input
          value={line}
          onChange={(event) => setLine(event.target.value)}
          aria-label="Comment line"
        />
        <input
          value={comment}
          onChange={(event) => setComment(event.target.value)}
          placeholder="Review comment"
        />
        <button
          onClick={() =>
            run(() =>
              request(
                "/api/agent/comments",
                post({ cwd, path, line: Number(line), body: comment }),
              ),
            )
          }
        >
          Comment
        </button>
        <button onClick={() => run(() => request(`/api/agent/comments?${query}`))}>
          List comments
        </button>
      </div>
      <ErrorText value={error} />
      {output === null ? null : <JsonView value={output} />}
    </article>
  );
}

function shellPath(path: string): string | null {
  if (!path || path.includes("\n") || path.includes("\r") || path.includes("\0")) return null;
  return `'${path.replaceAll("'", "'\"'\"'")}'`;
}
function GitTools({ cwd }: { cwd: string }) {
  const [path, setPath] = useState("");
  const [branch, setBranch] = useState("");
  const [worktree, setWorktree] = useState("");
  const [commit, setCommit] = useState("");
  const [output, setOutput] = useState<Json | null>(null);
  const [error, setError] = useState("");
  const query = `cwd=${encodeURIComponent(cwd)}`;
  const run = async (url: `/api/${string}`, init?: RequestInit) => {
    try {
      setOutput(await request(url, init));
      setError("");
    } catch (value) {
      setError(value instanceof Error ? value.message : String(value));
    }
  };
  const gitAction = (value: RecordJson) => run(`/api/agent/git?${query}`, post(value));
  const indexAction = (verb: "add" | "restore" | "revert") => {
    const quoted = shellPath(path);
    if (!quoted) {
      setError("Choose a safe relative path");
      return;
    }
    const command =
      verb === "add"
        ? `git add -- ${quoted}`
        : verb === "restore"
          ? `git restore --staged -- ${quoted}`
          : `git restore -- ${quoted}`;
    void run(`/api/agent/terminal?${query}`, post({ command }));
  };
  return (
    <article>
      <h3>Git review</h3>
      <div className="row">
        <button onClick={() => run(`/api/agent/git?${query}`)}>Diff & status</button>
        <button onClick={() => run(`/api/agent/git/branches?${query}`)}>Branches</button>
        <button onClick={() => run(`/api/agent/git/worktrees?${query}`)}>Worktrees</button>
        <button onClick={() => run(`/api/agent/pr?${query}`)}>Pull request</button>
      </div>
      <div className="row">
        <input
          value={path}
          onChange={(event) => setPath(event.target.value)}
          placeholder="Changed path"
        />
        <button onClick={() => indexAction("add")}>Stage</button>
        <button onClick={() => indexAction("restore")}>Unstage</button>
        <button onClick={() => indexAction("revert")}>Revert</button>
      </div>
      <div className="row">
        <input
          value={commit}
          onChange={(event) => setCommit(event.target.value)}
          placeholder="Commit message"
        />
        <button
          onClick={() =>
            gitAction({ action: "commit", message: commit, paths: path ? [path] : [] })
          }
        >
          Commit
        </button>
        <button onClick={() => gitAction({ action: "push" })}>Push</button>
      </div>
      <div className="row">
        <input
          value={branch}
          onChange={(event) => setBranch(event.target.value)}
          placeholder="Branch"
        />
        <button onClick={() => gitAction({ action: "switch_branch", branch })}>Switch</button>
        <button onClick={() => gitAction({ action: "create_branch", branch })}>Create</button>
        <input
          value={worktree}
          onChange={(event) => setWorktree(event.target.value)}
          placeholder="Worktree path"
        />
        <button onClick={() => gitAction({ action: "add_worktree", branch, path: worktree })}>
          Add worktree
        </button>
        <button onClick={() => gitAction({ action: "remove_worktree", path: worktree })}>
          Remove
        </button>
      </div>
      <ErrorText value={error} />
      {output === null ? null : <JsonView value={output} />}
    </article>
  );
}

function BrowserTools() {
  const [url, setUrl] = useState("http://localhost:3000");
  const [history, setHistory] = useState<string[]>([]);
  const [output, setOutput] = useState<Json | null>(null);
  const [error, setError] = useState("");
  const [frameVersion, setFrameVersion] = useState(0);
  const run = async (endpoint: `/api/${string}`, init?: RequestInit) => {
    try {
      setOutput(await request(endpoint, init));
      setError("");
      setFrameVersion((value) => value + 1);
    } catch (value) {
      setError(value instanceof Error ? value.message : String(value));
    }
  };
  const navigate = () => {
    setHistory((items) => [...items.filter((item) => item !== url), url].slice(-12));
    void run("/api/agent/browser/navigate", post({ url }));
  };
  return (
    <article>
      <h3>Local browser</h3>
      <div className="row">
        <input value={url} onChange={(event) => setUrl(event.target.value)} />
        <button onClick={navigate}>Navigate</button>
        <button onClick={() => run("/api/agent/browser/back", post({}))}>Back</button>
        <button onClick={() => run("/api/agent/browser/forward", post({}))}>Forward</button>
        <button onClick={() => run("/api/agent/browser/reload", post({}))}>Reload</button>
      </div>
      <div className="row">
        <button onClick={() => run(`/api/agent/browser/fetch?url=${encodeURIComponent(url)}`)}>
          Fetch text
        </button>
        <button onClick={() => run("/api/agent/browser/localhosts")}>Discover local apps</button>
        <button
          onClick={() => run("/api/agent/browser/viewport", post({ width: 1280, height: 800 }))}
        >
          1280 × 800
        </button>
        <button
          onClick={() => run("/api/agent/browser/input", post({ type: "key", key: "Enter" }))}
        >
          Send Enter
        </button>
      </div>
      <p>History: {history.join(" · ") || "None"}</p>
      <img
        src={`/api/agent/browser/frame?v=${frameVersion}`}
        alt="Current browser screencast frame"
      />
      <ErrorText value={error} />
      {output === null ? null : <JsonView value={output} />}
    </article>
  );
}

function TerminalTools({ cwd }: { cwd: string }) {
  const [id, setId] = useState("");
  const [input, setInput] = useState("");
  const [output, setOutput] = useState("");
  const [error, setError] = useState("");
  const stream = useRef<EventSource | null>(null);
  useMountSubscription(() => () => stream.current?.close(), []);
  const connect = (ptyId: string) => {
    stream.current?.close();
    const source = new EventSource(
      `/api/agent/terminal/pty/stream?id=${encodeURIComponent(ptyId)}`,
    );
    source.addEventListener("snapshot", (event) => setOutput(atob(event.data)));
    source.onmessage = (event) => setOutput((value) => value + atob(event.data));
    source.onerror = () => {
      source.close();
      window.setTimeout(() => connect(ptyId), 1500);
    };
    stream.current = source;
  };
  const open = async () => {
    try {
      const raw = await requestRecord(
        "/api/agent/terminal/pty/open",
        post({ cwd, cols: 100, rows: 28, ownerKey: `workspace:${cwd}` }),
      );
      const result = decodePtyOpenResponse(raw);
      const ptyId = result.id;
      setId(ptyId);
      if (result.replay !== undefined) setOutput(result.replay);
      connect(ptyId);
    } catch (value) {
      setError(value instanceof Error ? value.message : String(value));
    }
  };
  const action = async (name: "input" | "resize" | "close", value: RecordJson) => {
    try {
      await request(`/api/agent/terminal/pty/${name}`, post({ id, ...value }));
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    }
  };
  return (
    <article>
      <h3>Persistent terminal</h3>
      <div className="row">
        <button onClick={open}>{id ? "Reconnect" : "Open"}</button>
        <input
          value={input}
          onChange={(event) => setInput(event.target.value)}
          placeholder="Terminal input"
        />
        <button
          onClick={() => {
            void action("input", { data: `${input}\n` });
            setInput("");
          }}
        >
          Write
        </button>
        <button onClick={() => action("resize", { cols: 120, rows: 36 })}>Resize</button>
        <button onClick={() => action("close", {})}>Close</button>
      </div>
      <pre>{output || "Terminal output appears here."}</pre>
      <ErrorText value={error} />
    </article>
  );
}

export function WorkspaceTools({ cwd }: { cwd: string }) {
  return (
    <section className="tools">
      <h2>Explicit local tools</h2>
      <p>
        Reads stay local. Save, terminal, browser input, Git changes, and remote PR actions run only
        when you press their controls.
      </p>
      <div className="grid">
        <FileTools cwd={cwd} />
        <GitTools cwd={cwd} />
        <BrowserTools />
        <TerminalTools cwd={cwd} />
      </div>
    </section>
  );
}
