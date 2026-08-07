import {
  StdioClientTransport,
  type StdioServerParameters,
} from "@modelcontextprotocol/sdk/client/stdio.js";
import type { Transport } from "@modelcontextprotocol/sdk/shared/transport.js";
import type { JSONRPCMessage } from "@modelcontextprotocol/sdk/types.js";

export const MAX_MCP_STDIO_BUFFER_BYTES = 4 * 1024 * 1024;

export type McpProtocolErrorCode =
  | "frame-too-large"
  | "malformed-json"
  | "invalid-json-rpc"
  | "transport-error"
  | "transport-closed";

export class McpProtocolError extends Error {
  override readonly name = "McpProtocolError";

  constructor(
    readonly code: McpProtocolErrorCode,
    message: string,
    options?: ErrorOptions,
  ) {
    super(message, options);
  }
}

const protocolError = (error: unknown): McpProtocolError => {
  if (error instanceof McpProtocolError) return error;
  const cause = error instanceof Error ? error : new Error(String(error));
  if (cause.message.startsWith("ReadBuffer exceeded maximum size")) {
    return new McpProtocolError(
      "frame-too-large",
      `MCP stdio frame exceeds ${MAX_MCP_STDIO_BUFFER_BYTES} bytes`,
      { cause },
    );
  }
  if (cause instanceof SyntaxError) {
    return new McpProtocolError("malformed-json", "MCP stdio frame is not valid JSON", {
      cause,
    });
  }
  if (cause.name === "ZodError") {
    return new McpProtocolError(
      "invalid-json-rpc",
      "MCP stdio frame is not a valid JSON-RPC message",
      { cause },
    );
  }
  return new McpProtocolError("transport-error", cause.message, { cause });
};

export class BoundedStdioClientTransport implements Transport {
  onclose: Transport["onclose"] = undefined;
  onerror: Transport["onerror"] = undefined;
  onmessage: Transport["onmessage"] = undefined;
  private readonly inner: StdioClientTransport;
  private terminalError: McpProtocolError | null = null;
  private closing: Promise<void> | null = null;
  private closeNotified = false;

  constructor(
    parameters: StdioServerParameters,
    private readonly onTerminalError: (error: McpProtocolError) => void,
  ) {
    this.inner = new StdioClientTransport({
      ...parameters,
      maxBufferSize: MAX_MCP_STDIO_BUFFER_BYTES,
    });
    this.inner.onmessage = (message) => {
      if (!this.terminalError && !this.closing) this.onmessage?.(message);
    };
    this.inner.onerror = (error) => this.fail(error);
    this.inner.onclose = () => this.handleInnerClose();
  }

  get pid(): number | null {
    return this.inner.pid;
  }

  async start(): Promise<void> {
    try {
      await this.inner.start();
    } catch (error) {
      throw this.fail(error);
    }
  }

  async send(message: JSONRPCMessage): Promise<void> {
    if (this.terminalError) throw this.terminalError;
    try {
      await this.inner.send(message);
    } catch (error) {
      throw this.fail(error);
    }
  }

  close(): Promise<void> {
    if (this.closing) return this.closing;
    this.closing = this.inner.close().finally(() => this.notifyClose());
    return this.closing;
  }

  private fail(error: unknown): McpProtocolError {
    if (this.terminalError) return this.terminalError;
    const failure = protocolError(error);
    this.terminalError = failure;
    this.onTerminalError(failure);
    this.onerror?.(failure);
    void this.close().catch(() => undefined);
    return failure;
  }

  private handleInnerClose(): void {
    if (!this.closing && !this.terminalError) {
      const failure = new McpProtocolError("transport-closed", "MCP stdio connection closed");
      this.terminalError = failure;
      this.onTerminalError(failure);
    }
    this.notifyClose();
  }

  private notifyClose(): void {
    if (this.closeNotified) return;
    this.closeNotified = true;
    this.onclose?.();
  }
}
