import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import type { StdioServerParameters } from "@modelcontextprotocol/sdk/client/stdio.js";
import type { Transport } from "@modelcontextprotocol/sdk/shared/transport.js";
import {
  CallToolResultSchema,
  type CallToolRequest,
  type Tool,
  type ToolAnnotations,
} from "@modelcontextprotocol/sdk/types.js";
import { BoundedStdioClientTransport } from "./mcp-stdio-transport";

export { McpProtocolError } from "./mcp-stdio-transport";

export type McpToolAnnotations = ToolAnnotations;
export type McpToolInfo = Tool;
export type McpToolArguments = NonNullable<CallToolRequest["params"]["arguments"]>;
export type McpCallToolResult = Awaited<ReturnType<Client["callTool"]>>;

export interface McpConnection {
  listTools(): Promise<McpToolInfo[]>;
  callTool(name: string, args: McpToolArguments): Promise<McpCallToolResult>;
  close(): void;
}

export interface StdioTarget {
  transport: "stdio";
  command: string;
  args?: string[];
  env?: Record<string, string>;
  cwd?: string;
}

export interface HttpTarget {
  transport: "http";
  url: string;
  headers?: Record<string, string>;
  authorize?: (forceRefresh: boolean) => Promise<Record<string, string>>;
  signal?: AbortSignal;
}

export type McpTarget = StdioTarget | HttpTarget;

const CLIENT_INFO = { name: "local-studio", version: "2.0.0" };

const INHERITED_ENV_KEYS = [
  "PATH",
  "HOME",
  "USER",
  "SHELL",
  "TMPDIR",
  "LANG",
  "LC_ALL",
  "TERM",
  "SYSTEMROOT",
  "SystemRoot",
  "COMSPEC",
  "APPDATA",
  "LOCALAPPDATA",
  "USERPROFILE",
  "TEMP",
  "TMP",
] as const;

const processEnvironment = () => {
  const entries: [string, string][] = [];
  for (const key of INHERITED_ENV_KEYS) {
    const value = process.env[key];
    if (value !== undefined) entries.push([key, value]);
  }
  return Object.fromEntries(entries);
};

const combinedSignal = (
  requestSignal: AbortSignal | null | undefined,
  targetSignal: AbortSignal | undefined,
): AbortSignal | undefined => {
  if (requestSignal && targetSignal) return AbortSignal.any([requestSignal, targetSignal]);
  return requestSignal ?? targetSignal ?? undefined;
};

const authorizedFetch =
  (target: HttpTarget): typeof fetch =>
  async (input, init) => {
    const send = async (forceRefresh: boolean): Promise<Response> => {
      const headers = new Headers(init?.headers);
      const authorization = target.authorize ? await target.authorize(forceRefresh) : {};
      for (const [name, value] of Object.entries(authorization)) headers.set(name, value);
      return fetch(input, {
        ...init,
        headers,
        redirect: target.authorize ? "error" : "follow",
        signal: combinedSignal(init?.signal, target.signal),
      });
    };
    const response = await send(false);
    return response.status === 401 && target.authorize ? send(true) : response;
  };

class TerminalFailure {
  private error: Error | null = null;
  private reject: (error: Error) => void = () => undefined;
  private readonly failed = new Promise<never>((_, reject) => {
    this.reject = reject;
  });

  run<T>(operation: () => Promise<T>): Promise<T> {
    return this.error ? Promise.reject(this.error) : Promise.race([operation(), this.failed]);
  }

  fail(error: Error): Error {
    if (!this.error) {
      this.error = error;
      this.reject(error);
    }
    return this.error;
  }
}

interface TransportConnection {
  transport: Transport;
  terminal: TerminalFailure | null;
}

const transportFor = (target: McpTarget): TransportConnection => {
  if (target.transport === "stdio") {
    const terminal = new TerminalFailure();
    const options: StdioServerParameters = {
      command: target.command,
      args: target.args ?? [],
      env: { ...processEnvironment(), ...target.env },
      stderr: "pipe",
      cwd: target.cwd,
    };
    return {
      transport: new BoundedStdioClientTransport(options, (error) => terminal.fail(error)),
      terminal,
    };
  }
  return {
    transport: new StreamableHTTPClientTransport(new URL(target.url), {
      requestInit: { headers: target.headers ?? {} },
      fetch: authorizedFetch(target),
    }),
    terminal: null,
  };
};

class SdkMcpConnection implements McpConnection {
  private readonly client = new Client(CLIENT_INFO, { capabilities: {} });
  private readonly connected: Promise<void>;
  private readonly signal: AbortSignal | undefined;
  private readonly terminal: TerminalFailure | null;
  private closed = false;

  constructor(target: McpTarget) {
    const connection = transportFor(target);
    this.signal = target.transport === "http" ? target.signal : undefined;
    this.terminal = connection.terminal;
    this.connected = this.run(() =>
      this.client.connect(connection.transport, { signal: this.signal }),
    );
  }

  listTools(): Promise<McpToolInfo[]> {
    return this.run(async () => {
      await this.connected;
      const result = await this.client.listTools({}, { signal: this.signal });
      return result.tools;
    });
  }

  callTool(name: string, args: McpToolArguments): Promise<McpCallToolResult> {
    return this.run(async () => {
      await this.connected;
      return this.client.callTool({ name, arguments: args }, CallToolResultSchema, {
        signal: this.signal,
      });
    });
  }

  close(): void {
    if (this.closed) return;
    this.closed = true;
    this.terminal?.fail(new Error("MCP connection is closed"));
    void this.client.close().catch(() => undefined);
  }

  private run<T>(operation: () => Promise<T>): Promise<T> {
    return this.terminal ? this.terminal.run(operation) : operation();
  }
}

export const connectMcp = (target: McpTarget): McpConnection => new SdkMcpConnection(target);
