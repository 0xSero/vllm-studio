import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import type { Transport } from "@modelcontextprotocol/sdk/shared/transport.js";
import type { Tool, ToolAnnotations } from "@modelcontextprotocol/sdk/types.js";
import { createBoundedStdioTransport, McpProtocolError } from "./mcp-stdio-transport";

export { McpProtocolError } from "./mcp-stdio-transport";

export type McpToolAnnotations = ToolAnnotations;
export type McpToolInfo = Tool;

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

const processEnvironment = (): Record<string, string> =>
  Object.fromEntries(
    Object.entries(process.env).filter((entry): entry is [string, string] => entry[1] !== undefined),
  );

const combinedSignal = (
  requestSignal: AbortSignal | null | undefined,
  targetSignal: AbortSignal | undefined,
): AbortSignal | undefined => {
  if (requestSignal && targetSignal) return AbortSignal.any([requestSignal, targetSignal]);
  return requestSignal ?? targetSignal ?? undefined;
};

const authorizedFetch = (target: HttpTarget): typeof fetch =>
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

const transportFor = (
  target: McpTarget,
  onTerminalError: (error: Error) => void,
): Transport => {
  if (target.transport === "stdio") {
    return createBoundedStdioTransport(
      {
        command: target.command,
        args: target.args ?? [],
        env: { ...processEnvironment(), ...(target.env ?? {}) },
        ...(target.cwd ? { cwd: target.cwd } : {}),
        stderr: "pipe",
      },
      onTerminalError,
    );
  }
  return new StreamableHTTPClientTransport(new URL(target.url), {
    requestInit: { headers: target.headers ?? {} },
    fetch: authorizedFetch(target),
  });
};

class SdkMcpConnection implements McpConnection {
  private readonly client = new Client(CLIENT_INFO, { capabilities: {} });
  private readonly connected: Promise<void>;
  private readonly signal: AbortSignal | undefined;
  private readonly isStdio: boolean;
  private terminalError: Error | null = null;
  private rejectTerminal!: (error: Error) => void;
  private readonly terminal = new Promise<never>((_, reject) => {
    this.rejectTerminal = reject;
  });
  private closed = false;

  constructor(target: McpTarget) {
    this.isStdio = target.transport === "stdio";
    const transport = transportFor(target, (error) => this.fail(error));
    this.signal = target.transport === "http" ? target.signal : undefined;
    this.connected = this.run(() => this.client.connect(transport, { signal: this.signal }));
  }

  listTools(): Promise<McpToolInfo[]> {
    return this.run(async () => {
      await this.connected;
      const result = await this.client.listTools({}, { signal: this.signal });
      return result.tools;
    });
  }

  callTool(name: string, args: Record<string, unknown>): Promise<unknown> {
    return this.run(async () => {
      await this.connected;
      return this.client.callTool(
        { name, arguments: args },
        undefined,
        { signal: this.signal },
      );
    });
  }

  close(): void {
    if (this.closed) return;
    this.closed = true;
    if (this.isStdio) {
      this.fail(new McpProtocolError("transport-closed", "MCP stdio connection was closed"));
    }
    void this.client.close().catch(() => undefined);
  }

  private run<T>(operation: () => Promise<T>): Promise<T> {
    if (!this.isStdio) return operation();
    if (this.terminalError) return Promise.reject(this.terminalError);
    return Promise.race([operation(), this.terminal]);
  }

  private fail(error: Error): void {
    if (this.terminalError) return;
    this.terminalError = error;
    this.rejectTerminal(error);
  }
}

export const connectMcp = (target: McpTarget): McpConnection => new SdkMcpConnection(target);
