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

const GitStateSchema = Schema.Struct({
  isRepo: Schema.Boolean,
  branch: Schema.NullOr(Schema.String),
  status: Schema.Array(Schema.String),
  diff: Schema.String,
  additions: Schema.Number,
  deletions: Schema.Number,
});
const PullRequestResponseSchema = Schema.Struct({
  pr: Schema.optional(
    Schema.Struct({
      number: Schema.Number,
      title: Schema.String,
      state: Schema.String,
      url: Schema.String,
      mergeable: Schema.String,
    }),
  ),
});
type GitState = typeof GitStateSchema.Type;
type PullRequest = NonNullable<(typeof PullRequestResponseSchema.Type)["pr"]>;
const decodeGitState = Schema.decodeUnknownSync(GitStateSchema, { onExcessProperty: "preserve" });
const decodePullRequest = Schema.decodeUnknownSync(PullRequestResponseSchema, {
  onExcessProperty: "preserve",
});
const FileResponseSchema = Schema.Struct({ content: Schema.String });
const PtyOpenResponseSchema = Schema.Struct({
  id: Schema.String,
  replay: Schema.optional(Schema.String),
});
const FileSearchResponseSchema = Schema.Struct({
  entries: Schema.Array(
    Schema.Struct({
      name: Schema.String,
      path: Schema.String,
      rel: Schema.String,
      kind: Schema.Literals(["file", "directory"]),
    }),
  ),
});
const CommentListResponseSchema = Schema.Struct({
  comments: Schema.Array(
    Schema.Struct({
      id: Schema.String,
      line: Schema.Number,
      body: Schema.String,
      createdAt: Schema.String,
    }),
  ),
});
const BrowserFrameResponseSchema = Schema.Struct({
  data: Schema.Struct({
    frame: Schema.NullOr(Schema.String),
    url: Schema.String,
    title: Schema.String,
    canGoBack: Schema.Boolean,
    canGoForward: Schema.Boolean,
  }),
});
const decodeFileResponse = Schema.decodeUnknownSync(FileResponseSchema, {
  onExcessProperty: "preserve",
});
const decodePtyOpenResponse = Schema.decodeUnknownSync(PtyOpenResponseSchema, {
  onExcessProperty: "preserve",
});
const decodeFileSearchResponse = Schema.decodeUnknownSync(FileSearchResponseSchema, {
  onExcessProperty: "preserve",
});
const decodeCommentListResponse = Schema.decodeUnknownSync(CommentListResponseSchema, {
  onExcessProperty: "preserve",
});
const decodeBrowserFrameResponse = Schema.decodeUnknownSync(BrowserFrameResponseSchema, {
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
  const [entries, setEntries] = useState<(typeof FileSearchResponseSchema.Type)["entries"]>([]);
  const [comments, setComments] = useState<(typeof CommentListResponseSchema.Type)["comments"]>([]);
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
            run(async () => {
              const value = await requestRecord(
                `/api/agent/fs/search?cwd=${encodeURIComponent(cwd)}&q=${encodeURIComponent(path)}`,
              );
              setEntries(decodeFileSearchResponse(value).entries);
              return value;
            })
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
        <button
          onClick={() =>
            run(async () => {
              const value = await requestRecord(`/api/agent/comments?${query}`);
              setComments(decodeCommentListResponse(value).comments);
              return value;
            })
          }
        >
          List comments
        </button>
      </div>
      {entries.map((entry) => (
        <button key={entry.path} onClick={() => setPath(entry.rel)}>
          {entry.kind}: {entry.rel}
        </button>
      ))}
      {comments.map((entry) => (
        <p key={entry.id}>
          Line {entry.line}: {entry.body}
        </p>
      ))}
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
  const [prNumber, setPrNumber] = useState("");
  const [gitState, setGitState] = useState<GitState | null>(null);
  const [pullRequest, setPullRequest] = useState<PullRequest | null>(null);
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
  const refreshGit = async () => {
    try {
      const value = await requestRecord(`/api/agent/git?${query}`);
      setGitState(decodeGitState(value));
      setOutput(value);
      setError("");
    } catch (value) {
      setError(value instanceof Error ? value.message : String(value));
    }
  };
  const refreshPullRequest = async () => {
    try {
      const value = await requestRecord(`/api/agent/pr?${query}`);
      setPullRequest(decodePullRequest(value).pr ?? null);
      setOutput(value);
      setError("");
    } catch (value) {
      setError(value instanceof Error ? value.message : String(value));
    }
  };
  const gitAction = async (value: RecordJson) => {
    try {
      const response = await requestRecord(`/api/agent/git?${query}`, post(value));
      setGitState(decodeGitState(response));
      setOutput(response);
      setError("");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    }
  };
  const indexAction = (verb: "add" | "restore" | "revert") => {
    const quoted = shellPath(path);
    if (!quoted) {
      setError("Choose a safe relative path");
      return;
    }
    if (verb === "revert" && !window.confirm(`Discard all working-tree changes to ${path}?`))
      return;
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
        <button onClick={refreshGit}>Diff & status</button>
        <button onClick={() => run(`/api/agent/git/branches?${query}`)}>Branches</button>
        <button onClick={() => run(`/api/agent/git/worktrees?${query}`)}>Worktrees</button>
        <button onClick={refreshPullRequest}>Pull request</button>
      </div>
      <div className="row">
        <input
          value={prNumber}
          onChange={(event) => setPrNumber(event.target.value)}
          placeholder="Pull request number"
        />
        <button
          onClick={() => {
            if (!prNumber || !window.confirm(`Merge pull request #${prNumber} with squash?`))
              return;
            void run(
              "/api/agent/pr/merge",
              post({ cwd, number: Number(prNumber), method: "squash" }),
            );
          }}
        >
          Squash and merge
        </button>
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
      {gitState ? (
        <section>
          <p>
            Branch {gitState.branch ?? "detached"} · +{gitState.additions} -{gitState.deletions}
          </p>
          <pre>{gitState.diff || gitState.status.join("\n") || "Working tree clean"}</pre>
        </section>
      ) : null}
      {pullRequest ? (
        <p>
          PR #{pullRequest.number}: {pullRequest.title} · {pullRequest.state} ·{" "}
          {pullRequest.mergeable}
        </p>
      ) : null}
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
  const [frameUrl, setFrameUrl] = useState("");
  const refreshFrame = async () => {
    const response = decodeBrowserFrameResponse(await requestRecord("/api/agent/browser/frame"));
    setFrameUrl(response.data.frame ? `data:image/jpeg;base64,${response.data.frame}` : "");
    setUrl(response.data.url);
    setHistory((items) =>
      items.at(-1) === response.data.url ? items : [...items, response.data.url].slice(-24),
    );
  };
  const run = async (endpoint: `/api/${string}`, init?: RequestInit) => {
    try {
      setOutput(await request(endpoint, init));
      setError("");
      await refreshFrame();
    } catch (value) {
      setError(value instanceof Error ? value.message : String(value));
    }
  };
  const navigate = () => void run("/api/agent/browser/navigate", post({ url }));
  const sendEnter = async () => {
    try {
      const key = { kind: "key", key: "Enter", code: "Enter" };
      await request("/api/agent/browser/input", post({ ...key, type: "down" }));
      await request("/api/agent/browser/input", post({ ...key, type: "up" }));
      await refreshFrame();
    } catch (value) {
      setError(value instanceof Error ? value.message : String(value));
    }
  };
  useMountSubscription(() => {
    void refreshFrame().catch((value) =>
      setError(value instanceof Error ? value.message : String(value)),
    );
  }, []);
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
        <button onClick={sendEnter}>Send Enter</button>
      </div>
      <p>History: {history.join(" · ") || "None"}</p>
      {frameUrl ? <img src={frameUrl} alt="Current browser screencast frame" /> : null}
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
      if (name === "close") {
        stream.current?.close();
        stream.current = null;
        setId("");
      }
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
