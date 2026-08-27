import {
  StdioClientTransport,
  type StdioServerParameters,
} from "@modelcontextprotocol/sdk/client/stdio.js";
import type { Transport } from "@modelcontextprotocol/sdk/shared/transport.js";
import { JSONRPCMessageSchema, type JSONRPCMessage } from "@modelcontextprotocol/sdk/types.js";

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

const protocolError = (error: Error): McpProtocolError => {
  if (error instanceof McpProtocolError) return error;
  const cause = error;
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

type BufferedFrame = Buffer | McpProtocolError;

class BoundedMcpReadBuffer {
  private frames: BufferedFrame[] = [];
  private remainder: Buffer<ArrayBufferLike> = Buffer.alloc(0);
  private terminal = false;

  append(chunk: Buffer): void {
    if (this.terminal) return;
    const data = this.remainder.length ? Buffer.concat([this.remainder, chunk]) : chunk;
    let start = 0;
    for (let newline = data.indexOf(0x0a); newline >= 0; newline = data.indexOf(0x0a, start)) {
      if (newline - start + 1 > MAX_MCP_STDIO_BUFFER_BYTES) return this.overflow();
      this.frames.push(data.subarray(start, newline));
      start = newline + 1;
    }
    this.remainder = data.subarray(start);
    if (this.remainder.length > MAX_MCP_STDIO_BUFFER_BYTES) this.overflow();
  }

  readMessage(): JSONRPCMessage | null {
    const frame = this.frames.shift();
    if (!frame) return null;
    if (frame instanceof McpProtocolError) {
      this.clear();
      throw frame;
    }
    try {
      return JSONRPCMessageSchema.parse(JSON.parse(frame.toString("utf8").replace(/\r$/, "")));
    } catch (error) {
      this.clear();
      throw error;
    }
  }

  clear(): void {
    this.frames = [];
    this.remainder = Buffer.alloc(0);
    this.terminal = false;
  }

  private overflow(): void {
    this.remainder = Buffer.alloc(0);
    this.terminal = true;
    this.frames.push(
      new McpProtocolError(
        "frame-too-large",
        `MCP stdio frame exceeds ${MAX_MCP_STDIO_BUFFER_BYTES} bytes`,
      ),
    );
  }
}

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
    Reflect.set(this.inner, "_readBuffer", new BoundedMcpReadBuffer());
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
      throw this.fail(error instanceof Error ? error : new Error(String(error)));
    }
  }

  async send(message: JSONRPCMessage): Promise<void> {
    if (this.terminalError) throw this.terminalError;
    try {
      await this.inner.send(message);
    } catch (error) {
      throw this.fail(error instanceof Error ? error : new Error(String(error)));
    }
  }

  close(): Promise<void> {
    if (this.closing) return this.closing;
    this.closing = this.inner.close().finally(() => this.notifyClose());
    return this.closing;
  }

  private fail(error: Error): McpProtocolError {
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
