// Minimal MCP client: enough protocol to list and call tools on a connector.
// Speaks newline-delimited JSON-RPC over stdio (official SDK transport) and
// plain JSON POST for streamable-http servers. Deliberately dependency-free.

import { spawn, type ChildProcess } from "child_process";

export interface McpToolInfo {
  name: string;
  description?: string;
  inputSchema?: Record<string, unknown>;
}

export interface McpConnection {
  listTools(): Promise<McpToolInfo[]>;
  callTool(name: string, args: Record<string, unknown>): Promise<unknown>;
  close(): void;
}

export interface StdioTarget {
  transport: "stdio";
  command: string;
  args?: string[];
  env?: Record<string, string>;
}

export interface HttpTarget {
  transport: "http";
  url: string;
  headers?: Record<string, string>;
}

export type McpTarget = StdioTarget | HttpTarget;

const PROTOCOL_VERSION = "2025-03-26";
const CLIENT_INFO = { name: "local-studio", version: "1.0.0" };
const DEFAULT_TIMEOUT_MS = 60_000;

interface JsonRpcResponse {
  id?: number;
  result?: unknown;
  error?: { code: number; message: string };
  method?: string;
}

class StdioMcpConnection implements McpConnection {
  private child: ChildProcess;
  private nextId = 1;
  private pending = new Map<
    number,
    { resolve: (value: unknown) => void; reject: (error: Error) => void; timer: NodeJS.Timeout }
  >();
  private buffer = "";
  private initialized: Promise<void>;
  private stderrTail = "";

  constructor(target: StdioTarget) {
    this.child = spawn(target.command, target.args ?? [], {
      stdio: ["pipe", "pipe", "pipe"],
      env: { ...process.env, ...(target.env ?? {}) },
    });
    this.child.stdout?.on("data", (chunk: Buffer) => this.onData(chunk));
    this.child.stderr?.on("data", (chunk: Buffer) => {
      this.stderrTail = `${this.stderrTail}${chunk.toString("utf8")}`.slice(-2000);
    });
    this.child.on("close", () => {
      const error = new Error(
        `MCP server exited${this.stderrTail ? `: ${this.stderrTail.trim().split("\n").pop()}` : ""}`,
      );
      for (const entry of this.pending.values()) {
        clearTimeout(entry.timer);
        entry.reject(error);
      }
      this.pending.clear();
    });
    this.initialized = this.initialize();
  }

  private onData(chunk: Buffer): void {
    this.buffer += chunk.toString("utf8");
    let newline = this.buffer.indexOf("\n");
    while (newline !== -1) {
      const line = this.buffer.slice(0, newline).trim();
      this.buffer = this.buffer.slice(newline + 1);
      newline = this.buffer.indexOf("\n");
      if (!line) continue;
      try {
        const message = JSON.parse(line) as JsonRpcResponse;
        if (typeof message.id === "number" && this.pending.has(message.id)) {
          const entry = this.pending.get(message.id)!;
          this.pending.delete(message.id);
          clearTimeout(entry.timer);
          if (message.error) entry.reject(new Error(message.error.message));
          else entry.resolve(message.result);
        }
        // Server-initiated requests/notifications are ignored; tools-only client.
      } catch {
        // Non-JSON line on stdout (some servers log there) — skip it.
      }
    }
  }

  private request(method: string, params?: Record<string, unknown>): Promise<unknown> {
    const id = this.nextId++;
    const payload = `${JSON.stringify({ jsonrpc: "2.0", id, method, ...(params ? { params } : {}) })}\n`;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`MCP request "${method}" timed out`));
      }, DEFAULT_TIMEOUT_MS);
      this.pending.set(id, { resolve, reject, timer });
      this.child.stdin?.write(payload, (error) => {
        if (error) {
          this.pending.delete(id);
          clearTimeout(timer);
          reject(error);
        }
      });
    });
  }

  private notify(method: string): void {
    this.child.stdin?.write(`${JSON.stringify({ jsonrpc: "2.0", method })}\n`);
  }

  private async initialize(): Promise<void> {
    await this.request("initialize", {
      protocolVersion: PROTOCOL_VERSION,
      capabilities: {},
      clientInfo: CLIENT_INFO,
    });
    this.notify("notifications/initialized");
  }

  async listTools(): Promise<McpToolInfo[]> {
    await this.initialized;
    const result = (await this.request("tools/list", {})) as { tools?: McpToolInfo[] };
    return result.tools ?? [];
  }

  async callTool(name: string, args: Record<string, unknown>): Promise<unknown> {
    await this.initialized;
    return this.request("tools/call", { name, arguments: args });
  }

  close(): void {
    this.child.kill("SIGTERM");
  }
}

class HttpMcpConnection implements McpConnection {
  private nextId = 1;
  private sessionId: string | null = null;
  private initialized: Promise<void>;

  constructor(private target: HttpTarget) {
    this.initialized = this.initialize();
  }

  private async request(method: string, params?: Record<string, unknown>): Promise<unknown> {
    const response = await fetch(this.target.url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json, text/event-stream",
        ...(this.sessionId ? { "Mcp-Session-Id": this.sessionId } : {}),
        ...(this.target.headers ?? {}),
      },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: this.nextId++,
        method,
        ...(params ? { params } : {}),
      }),
      signal: AbortSignal.timeout(DEFAULT_TIMEOUT_MS),
    });
    const session = response.headers.get("Mcp-Session-Id");
    if (session) this.sessionId = session;
    if (!response.ok) throw new Error(`MCP HTTP ${response.status}`);
    const contentType = response.headers.get("content-type") ?? "";
    let message: JsonRpcResponse;
    if (contentType.includes("text/event-stream")) {
      const text = await response.text();
      const dataLine = text
        .split("\n")
        .filter((line) => line.startsWith("data:"))
        .pop();
      if (!dataLine) throw new Error("MCP HTTP: empty event stream response");
      message = JSON.parse(dataLine.slice(5).trim()) as JsonRpcResponse;
    } else {
      message = (await response.json()) as JsonRpcResponse;
    }
    if (message.error) throw new Error(message.error.message);
    return message.result;
  }

  private async initialize(): Promise<void> {
    await this.request("initialize", {
      protocolVersion: PROTOCOL_VERSION,
      capabilities: {},
      clientInfo: CLIENT_INFO,
    });
  }

  async listTools(): Promise<McpToolInfo[]> {
    await this.initialized;
    const result = (await this.request("tools/list", {})) as { tools?: McpToolInfo[] };
    return result.tools ?? [];
  }

  async callTool(name: string, args: Record<string, unknown>): Promise<unknown> {
    await this.initialized;
    return this.request("tools/call", { name, arguments: args });
  }

  close(): void {
    // HTTP connections are stateless per request; nothing to tear down.
  }
}

export const connectMcp = (target: McpTarget): McpConnection =>
  target.transport === "stdio" ? new StdioMcpConnection(target) : new HttpMcpConnection(target);
