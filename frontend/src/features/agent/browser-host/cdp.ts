// Minimal Chrome DevTools Protocol client over a WebSocket.
//
// CDP client and snapshot approach adapted from Ghostex (MIT, maddada).
//
// JSON-RPC with incrementing ids and a pending map, per-call timeout, event
// listeners, and clean close handling (every in-flight call rejects). Page-level
// DevTools endpoints (each page's webSocketDebuggerUrl) are connected directly,
// so flat-mode sessionId routing is optional and only used when supplied.

import WebSocket from "ws";

const DEFAULT_CALL_TIMEOUT_MS = 10_000;
const CONNECT_TIMEOUT_MS = 10_000;

export type CdpEvent = { method: string; params?: Record<string, unknown>; sessionId?: string };

type CdpResponse = {
  id?: number;
  result?: Record<string, unknown>;
  error?: { message?: string };
  method?: string;
  params?: Record<string, unknown>;
  sessionId?: string;
};

type PendingCall = {
  resolve: (value: Record<string, unknown>) => void;
  reject: (error: Error) => void;
  timer: ReturnType<typeof setTimeout>;
};

type EventListener = (event: CdpEvent) => void;

export class CdpClient {
  private socket: WebSocket;
  private nextId = 1;
  private pending = new Map<number, PendingCall>();
  private listeners = new Map<string, Set<EventListener>>();
  private timeoutMs: number;
  // Serializes outgoing writes. The bundled (webpack) `ws` build runs its pure-JS
  // frame masker without the native `bufferutil` addon; firing socket.send()
  // again while a previous frame is still buffered corrupts the masked bytes on
  // the wire, and Chromium rejects them with JSON-RPC -32700 (parse error). The
  // calls that get garbled never resolve, so they time out. Chaining each send
  // behind the previous send's write callback keeps exactly one frame in flight.
  private writeChain: Promise<void> = Promise.resolve();
  closed = false;

  private constructor(socket: WebSocket, timeoutMs: number) {
    this.socket = socket;
    this.timeoutMs = timeoutMs;
    socket.on("message", (data) => this.handleMessage(String(data)));
    socket.on("close", () => this.handleClose("CDP connection closed"));
    socket.on("error", () => this.handleClose("CDP connection error"));
  }

  static connect(wsEndpoint: string, timeoutMs = DEFAULT_CALL_TIMEOUT_MS): Promise<CdpClient> {
    return new Promise<CdpClient>((resolve, reject) => {
      const socket = new WebSocket(wsEndpoint, { maxPayload: 256 * 1024 * 1024 });
      const timer = setTimeout(() => {
        socket.terminate();
        reject(new Error("Timed out opening CDP WebSocket"));
      }, CONNECT_TIMEOUT_MS);
      socket.once("open", () => {
        clearTimeout(timer);
        resolve(new CdpClient(socket, timeoutMs));
      });
      socket.once("error", (error: Error) => {
        clearTimeout(timer);
        reject(error);
      });
    });
  }

  call(
    method: string,
    params: Record<string, unknown> = {},
    sessionId?: string,
  ): Promise<Record<string, unknown>> {
    if (this.closed) return Promise.reject(new Error("CDP connection is closed"));
    const id = this.nextId++;
    return new Promise<Record<string, unknown>>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`Timed out waiting for CDP method ${method}`));
      }, this.timeoutMs);
      this.pending.set(id, { resolve, reject, timer });
      const message: Record<string, unknown> = { id, method, params };
      if (sessionId) message.sessionId = sessionId;
      this.enqueueSend(JSON.stringify(message)).catch((error: Error) => {
        const call = this.pending.get(id);
        if (call) {
          clearTimeout(call.timer);
          this.pending.delete(id);
          reject(error);
        }
      });
    });
  }

  // One write at a time: each send waits for the previous send's write callback
  // (the socket fully draining that frame) before the next frame is masked and
  // written. See the writeChain field comment for why overlap corrupts the wire.
  private enqueueSend(payload: string): Promise<void> {
    const send = this.writeChain.then(
      () =>
        new Promise<void>((resolve, reject) => {
          if (this.closed) {
            reject(new Error("CDP connection is closed"));
            return;
          }
          this.socket.send(payload, (error) => (error ? reject(error) : resolve()));
        }),
    );
    // Keep the chain alive even if this send rejects, so a single failed write
    // never wedges every later call behind a permanently-rejected promise.
    this.writeChain = send.catch(() => undefined);
    return send;
  }

  on(method: string, callback: EventListener): () => void {
    let set = this.listeners.get(method);
    if (!set) {
      set = new Set();
      this.listeners.set(method, set);
    }
    set.add(callback);
    return () => {
      this.listeners.get(method)?.delete(callback);
    };
  }

  close(): void {
    this.handleClose("CDP connection closed");
    try {
      this.socket.close();
    } catch {
      this.socket.terminate();
    }
  }

  private handleMessage(raw: string): void {
    let parsed: CdpResponse;
    try {
      parsed = JSON.parse(raw) as CdpResponse;
    } catch {
      return;
    }
    if (typeof parsed.id === "number") {
      const call = this.pending.get(parsed.id);
      if (!call) return;
      clearTimeout(call.timer);
      this.pending.delete(parsed.id);
      if (parsed.error) call.reject(new Error(parsed.error.message ?? "CDP error"));
      else call.resolve(parsed.result ?? {});
      return;
    }
    if (parsed.method) {
      const event: CdpEvent = {
        method: parsed.method,
        params: parsed.params,
        ...(parsed.sessionId ? { sessionId: parsed.sessionId } : {}),
      };
      for (const listener of this.listeners.get(parsed.method) ?? []) listener(event);
    }
  }

  private handleClose(reason: string): void {
    if (this.closed) return;
    this.closed = true;
    for (const call of this.pending.values()) {
      clearTimeout(call.timer);
      call.reject(new Error(reason));
    }
    this.pending.clear();
    this.listeners.clear();
  }
}
