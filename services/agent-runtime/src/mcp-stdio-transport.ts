import {
  StdioClientTransport,
  type StdioServerParameters,
} from "@modelcontextprotocol/sdk/client/stdio.js";
import type { Transport } from "@modelcontextprotocol/sdk/shared/transport.js";
import { JSONRPCMessageSchema, type JSONRPCMessage } from "@modelcontextprotocol/sdk/types.js";

export const MAX_MCP_STDIO_FRAME_BYTES = 4 * 1024 * 1024;

export type McpProtocolErrorCode =
  | "frame-too-large"
  | "invalid-utf8"
  | "malformed-json"
  | "invalid-json-rpc"
  | "truncated-frame"
  | "transport-error"
  | "transport-closed"
  | "transport-unsupported";

export class McpProtocolError extends Error {
  override readonly name = "McpProtocolError";

  constructor(readonly code: McpProtocolErrorCode, message: string) {
    super(message);
  }
}

type FramedItem = JSONRPCMessage | McpProtocolError;

class BoundedMcpReadBuffer {
  private bytes = Buffer.allocUnsafe(1024);
  private length = 0;
  private items: FramedItem[] = [];
  private head = 0;
  private terminal = false;
  private readonly decoder = new TextDecoder("utf-8", { fatal: true });

  append(chunk: Buffer): void {
    if (this.terminal) return;
    let offset = 0;
    while (offset < chunk.length) {
      const newline = chunk.indexOf(0x0a, offset);
      const end = newline === -1 ? chunk.length : newline;
      const segment = chunk.subarray(offset, end);
      const total = this.length + segment.length;
      const trailingByte =
        segment.length > 0 ? segment[segment.length - 1] : this.bytes[this.length - 1];
      const framedCr = newline !== -1 && trailingByte === 0x0d;
      const provisionalCr = newline === -1 && total === MAX_MCP_STDIO_FRAME_BYTES + 1 && trailingByte === 0x0d;
      if (total - (framedCr ? 1 : 0) > MAX_MCP_STDIO_FRAME_BYTES && !provisionalCr) {
        this.queueError(
          new McpProtocolError(
            "frame-too-large",
            `MCP stdio frame payload exceeds ${MAX_MCP_STDIO_FRAME_BYTES} bytes`,
          ),
        );
        return;
      }
      this.write(segment);
      if (newline === -1) return;
      this.queueFrame();
      if (this.terminal) return;
      offset = newline + 1;
    }
  }

  readMessage(): JSONRPCMessage | null {
    const item = this.items[this.head];
    if (!item) return null;
    this.head += 1;
    if (this.head === this.items.length) {
      this.items = [];
      this.head = 0;
    }
    if (item instanceof McpProtocolError) {
      this.length = 0;
      this.items = [];
      this.head = 0;
      this.terminal = true;
      throw item;
    }
    return item;
  }

  clear(): void {
    this.length = 0;
    this.items = [];
    this.head = 0;
    this.terminal = false;
  }

  hasPartialFrame(): boolean {
    return this.length > 0;
  }

  private write(segment: Buffer): void {
    if (segment.length === 0) return;
    const required = this.length + segment.length;
    if (required > this.bytes.length) {
      let capacity = this.bytes.length;
      while (capacity < required) {
        capacity = Math.min(MAX_MCP_STDIO_FRAME_BYTES + 1, capacity * 2);
      }
      const grown = Buffer.allocUnsafe(capacity);
      this.bytes.copy(grown, 0, 0, this.length);
      this.bytes = grown;
    }
    segment.copy(this.bytes, this.length);
    this.length = required;
  }

  private queueFrame(): void {
    let text: string;
    try {
      text = this.decoder.decode(this.bytes.subarray(0, this.length));
    } catch {
      this.queueError(new McpProtocolError("invalid-utf8", "MCP stdio frame is not valid UTF-8"));
      return;
    }
    this.length = 0;
    if (text.endsWith("\r")) text = text.slice(0, -1);
    let value: unknown;
    try {
      value = JSON.parse(text);
    } catch {
      this.queueError(new McpProtocolError("malformed-json", "MCP stdio frame is not valid JSON"));
      return;
    }
    try {
      this.items.push(JSONRPCMessageSchema.parse(value));
    } catch {
      this.queueError(
        new McpProtocolError(
          "invalid-json-rpc",
          "MCP stdio frame is not a valid JSON-RPC message",
        ),
      );
    }
  }

  private queueError(error: McpProtocolError): void {
    this.length = 0;
    this.terminal = true;
    this.items.push(error);
  }
}

const installReadBuffer = (
  transport: StdioClientTransport,
  buffer: BoundedMcpReadBuffer,
): void => {
  const descriptor = Object.getOwnPropertyDescriptor(transport, "_readBuffer");
  const current = descriptor && "value" in descriptor ? descriptor.value : undefined;
  const compatible = ["append", "readMessage", "clear"].every(
    (name) => typeof current === "object" && current && typeof Reflect.get(current, name) === "function",
  );
  if (
    descriptor?.writable !== true ||
    !compatible ||
    !Reflect.set(transport, "_readBuffer", buffer) ||
    Reflect.get(transport, "_readBuffer") !== buffer
  ) {
    throw new McpProtocolError(
      "transport-unsupported",
      "MCP SDK stdio read-buffer seam is incompatible",
    );
  }
};

export const createBoundedStdioTransport = (
  parameters: StdioServerParameters,
  onTerminalError: (error: McpProtocolError) => void,
): Transport => {
  const buffer = new BoundedMcpReadBuffer();
  const transport = new StdioClientTransport({
    ...parameters,
    maxBufferSize: MAX_MCP_STDIO_FRAME_BYTES,
  });
  installReadBuffer(transport, buffer);
  let terminalError: McpProtocolError | null = null;
  let closing: Promise<void> | null = null;
  const settle = (error: unknown): McpProtocolError => {
    if (terminalError) return terminalError;
    terminalError =
      error instanceof McpProtocolError
        ? error
        : new McpProtocolError(
            "transport-error",
            error instanceof Error ? error.message : String(error),
          );
    onTerminalError(terminalError);
    return terminalError;
  };
  transport.onerror = (error) => {
    settle(error);
    closing ??= transport.close().catch(() => undefined);
  };
  transport.onclose = () => {
    settle(
      buffer.hasPartialFrame()
        ? new McpProtocolError("truncated-frame", "MCP stdio connection closed mid-frame")
        : new McpProtocolError("transport-closed", "MCP stdio connection closed"),
    );
  };
  return transport;
};
