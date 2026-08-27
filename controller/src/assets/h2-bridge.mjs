#!/usr/bin/env node
/**
 * Dumb HTTP/2 bidirectional pipe for Cursor gRPC.
 *
 * Originally from https://github.com/ephraimduncan/opencode-cursor by Ephraim Duncan (MIT).
 *
 * Bun's node:http2 is broken. This Node script acts as a transparent
 * HTTP/2 proxy: it opens a single bidirectional stream and ferries
 * raw bytes between the parent process (via stdin/stdout) and Cursor.
 *
 * Protocol (length-prefixed framing over stdin/stdout):
 *   [4 bytes big-endian length][payload]
 *
 * First message on stdin is JSON config:
 *   { "accessToken": "...", "url": "...", "path": "...", "unary": false, "persistent": true }
 *
 * When unary=true, the bridge uses application/proto (raw protobuf) instead
 * of application/connect+proto (Connect streaming). The single stdin message
 * is written as the request body and the stream is ended immediately.
 *
 * Streaming with persistent=true (the default for chat) keeps the HTTP/2
 * session after a stream ends, writes a STREAM_DONE sentinel, and waits for
 * an `{"cmd":"open"}` stdin message to open the next Connect stream — so later
 * turns skip process spawn + TLS.
 *
 * After config, subsequent stdin messages are raw bytes to write to the H2 stream.
 * H2 response data is written to stdout using the same length-prefixed framing.
 */
import http2 from "node:http2";
import crypto from "node:crypto";
import { once } from "node:events";

const CURSOR_CLIENT_VERSION = process.env.PI_CURSOR_CLIENT_VERSION || "cli-2026.05.01-eea359f";
const MAX_BRIDGE_MESSAGE_BYTES = 64 * 1024 * 1024;
const MAX_ERROR_BODY_BYTES = 1024 * 1024;

/** Write one length-prefixed message to stdout. */
function writeMessage(data) {
  if (data.length > MAX_BRIDGE_MESSAGE_BYTES) {
    throw new Error(`bridge output exceeds ${MAX_BRIDGE_MESSAGE_BYTES} bytes`);
  }
  const lenBuf = Buffer.alloc(4);
  lenBuf.writeUInt32BE(data.length, 0);
  return process.stdout.write(Buffer.concat([lenBuf, data]));
}

function connectEndStreamError(code, message) {
  const payload = Buffer.from(JSON.stringify({ error: { code, message } }), "utf8");
  const frame = Buffer.alloc(5 + payload.length);
  frame[0] = 0b00000010;
  frame.writeUInt32BE(payload.length, 1);
  payload.copy(frame, 5);
  return frame;
}

// --- Buffered stdin reader ---
//
// Chunks are queued in an array and only concatenated once enough bytes have arrived to satisfy
// a `readExact` call. Concatenating on every `data` event instead (`stdinBuf = Buffer.concat([
// stdinBuf, chunk])`) is O(n^2) in the message size when a large message arrives split across
// many small pipe reads, since every partial chunk re-copies everything buffered so far.

let stdinChunks = [];
let stdinLength = 0;
let stdinResolve = null;
let stdinEnded = false;

process.stdin.on("data", (chunk) => {
  stdinChunks.push(chunk);
  stdinLength += chunk.length;
  if (stdinLength > MAX_BRIDGE_MESSAGE_BYTES + 4) {
    process.stderr.write("[h2-bridge] stdin buffer limit exceeded\n");
    process.exit(1);
  }
  if (stdinResolve) {
    const r = stdinResolve;
    stdinResolve = null;
    r();
  }
});

process.stdin.on("end", () => {
  stdinEnded = true;
  if (stdinResolve) {
    const r = stdinResolve;
    stdinResolve = null;
    r();
  }
});

function waitForData() {
  return new Promise((resolve) => {
    stdinResolve = resolve;
  });
}

async function readExact(n) {
  while (stdinLength < n) {
    if (stdinEnded) return null;
    await waitForData();
  }
  if (stdinChunks.length > 1) stdinChunks = [Buffer.concat(stdinChunks, stdinLength)];
  const buf = stdinChunks[0] ?? Buffer.alloc(0);
  const result = buf.subarray(0, n);
  const rest = buf.subarray(n);
  stdinChunks = rest.length > 0 ? [rest] : [];
  stdinLength = rest.length;
  return Buffer.from(result);
}

async function readMessage() {
  const lenBuf = await readExact(4);
  if (!lenBuf) return null;
  const len = lenBuf.readUInt32BE(0);
  if (len > MAX_BRIDGE_MESSAGE_BYTES) {
    throw new Error(`bridge input exceeds ${MAX_BRIDGE_MESSAGE_BYTES} bytes`);
  }
  if (len === 0) return Buffer.alloc(0);
  return readExact(len);
}

// --- Main ---

const configBuf = await readMessage();
if (!configBuf) process.exit(1);

let config;
try {
  config = JSON.parse(configBuf.toString("utf8"));
} catch {
  process.stderr.write("[h2-bridge] invalid config JSON\n");
  process.exit(1);
}
if (!config || typeof config !== "object") {
  process.stderr.write("[h2-bridge] config must be a JSON object\n");
  process.exit(1);
}
const { accessToken, url, path: rpcPath, unary, persistent: persistentFlag } = config;
const persistent = unary ? false : persistentFlag !== false;
const STREAM_DONE_MAGIC = Buffer.from("PI_CURSOR_STREAM_DONE");
// Connect timeout still protects against a hung first handshake (default 30s).
// Activity idle is off by default (0) so long agent turns are not killed;
// set idleTimeoutMs / PI_CURSOR_H2_IDLE_TIMEOUT_MS to re-enable a safety net.
// Parent heartbeats every 5s also reset the timer when it is enabled.
const connectTimeoutMs = optionalMs(config.connectTimeoutMs, 30_000);
const idleTimeoutMs = optionalMs(config.idleTimeoutMs, 0);

/** Parse ms; 0 means disabled. Invalid/missing uses fallback. */
function optionalMs(value, fallback) {
  if (value === undefined || value === null || value === "") return fallback;
  const n = Number(value);
  if (!Number.isFinite(n) || n < 0) return fallback;
  if (n === 0) return 0;
  return Math.floor(n);
}

const client = http2.connect(url || "https://api2.cursor.sh");

// HTTP/2 PING keeps intermediary/load-balancer sessions alive during long pure-thinking
// stretches where no DATA frames flow. Cursor may otherwise GOAWAY the stream mid-turn.
const pingEveryMs = optionalMs(config.pingIntervalMs, 20_000);
let pingTimer = undefined;
if (pingEveryMs > 0) {
  pingTimer = setInterval(() => {
    if (client.destroyed || client.closed) return;
    try {
      client.ping((err) => {
        if (err) {
          process.stderr.write(`[h2-bridge] ping failed: ${err.message}\n`);
        }
      });
    } catch (err) {
      process.stderr.write(
        `[h2-bridge] ping threw: ${err instanceof Error ? err.message : String(err)}\n`,
      );
    }
  }, pingEveryMs);
  pingTimer.unref?.();
}

// Optional watchdog: connect timeout until first activity, then activity idle.
let timeout = undefined;

function clearBridgeTimeout() {
  if (timeout) clearTimeout(timeout);
  timeout = undefined;
}

function armBridgeTimeout(ms) {
  clearBridgeTimeout();
  if (!ms || ms <= 0) return;
  timeout = setTimeout(killBridge, ms);
}

function resetTimeout() {
  // After first I/O, only the activity idle (if enabled) applies.
  armBridgeTimeout(idleTimeoutMs);
}

function killBridge() {
  clearBridgeTimeout();
  if (pingTimer) clearInterval(pingTimer);
  client.destroy();
  process.exit(1);
}

// Initial connect guard only (skipped when connectTimeoutMs is 0).
armBridgeTimeout(connectTimeoutMs);

client.on("error", (err) => {
  clearBridgeTimeout();
  if (pingTimer) clearInterval(pingTimer);
  process.stderr.write(
    `[h2-bridge] client error: ${err instanceof Error ? err.message : String(err)}\n`,
  );
  process.exit(1);
});

client.on("goaway", (errorCode, _lastStreamId, opaqueData) => {
  const opaque = opaqueData ? opaqueData.toString("utf8").slice(0, 200) : "";
  process.stderr.write(`[h2-bridge] GOAWAY errorCode=${errorCode} opaque=${opaque}\n`);
  // GOAWAY means the server closed the HTTP/2 connection gracefully.
  // Signal the parent with a retriable error frame so it can reconnect,
  // then exit with code 2 (reserved for retriable transport loss).
  clearBridgeTimeout();
  if (pingTimer) clearInterval(pingTimer);
  writeMessage(
    connectEndStreamError(
      "unavailable",
      `Cursor GOAWAY (errorCode=${errorCode}): upstream connection closed, retriable`,
    ),
  );
  setTimeout(() => process.exit(2), 100);
});

function requestHeaders(token) {
  return {
    ":method": "POST",
    ":path": rpcPath || "/agent.v1.AgentService/Run",
    "content-type": unary ? "application/proto" : "application/connect+proto",
    "connect-protocol-version": "1",
    te: "trailers",
    authorization: `Bearer ${token}`,
    "x-ghost-mode": "true",
    "x-cursor-client-version": CURSOR_CLIENT_VERSION,
    "x-cursor-client-type": "cli",
    "x-request-id": crypto.randomUUID(),
  };
}

function parseOpenCommand(msg) {
  if (!msg || msg.length === 0 || msg[0] !== 0x7b) return undefined;
  try {
    const parsed = JSON.parse(msg.toString("utf8"));
    if (parsed && parsed.cmd === "open") return parsed;
  } catch {
    // Binary Connect frames that happen to start with `{` are not open commands.
  }
  return undefined;
}

function attachStream(h2Stream) {
  let responseStatus = 0;
  let responseStatusText = "";
  const errorChunks = [];
  let errorBodyBytes = 0;
  const isErrorStatus = () => responseStatus !== 0 && (responseStatus < 200 || responseStatus >= 300);

  h2Stream.on("response", (responseHeaders) => {
    resetTimeout();
    responseStatus = Number(responseHeaders[":status"] || 0);
    responseStatusText =
      responseHeaders["grpc-message"] || responseHeaders["connect-error-message"] || "";
  });

  h2Stream.on("data", (chunk) => {
    resetTimeout();
    if (isErrorStatus()) {
      const remaining = MAX_ERROR_BODY_BYTES - errorBodyBytes;
      if (remaining > 0) {
        const kept = Buffer.from(chunk).subarray(0, remaining);
        errorChunks.push(kept);
        errorBodyBytes += kept.byteLength;
      }
    } else if (!writeMessage(chunk)) {
      h2Stream.pause();
      process.stdout.once("drain", () => h2Stream.resume());
    }
  });

  return new Promise((resolve) => {
    const finish = (result) => {
      resolve(result);
    };

    h2Stream.on("end", () => {
      if (isErrorStatus()) {
        const body = Buffer.concat(errorChunks).toString("utf8").trim();
        const detail = responseStatusText || body || "HTTP/2 upstream request failed";
        writeMessage(
          connectEndStreamError(`http_${responseStatus}`, `Cursor HTTP ${responseStatus}: ${detail}`),
        );
        finish({ ok: false, fatal: true });
        return;
      }
      finish({ ok: true, fatal: false });
    });

    h2Stream.on("error", (err) => {
      process.stderr.write(
        `[h2-bridge] stream error: ${err instanceof Error ? err.message : String(err)}\n`,
      );
      finish({ ok: false, fatal: true });
    });
  });
}

function shutdownClient(code) {
  clearBridgeTimeout();
  if (pingTimer) clearInterval(pingTimer);
  try {
    client.close();
  } catch {
    // Already closed.
  }
  setTimeout(() => process.exit(code), 100);
}

if (unary) {
  const h2Stream = client.request(requestHeaders(accessToken));
  const ended = attachStream(h2Stream);
  const body = await readMessage();
  if (body && body.length > 0 && !h2Stream.closed && !h2Stream.destroyed) {
    h2Stream.end(body);
  } else {
    h2Stream.end();
  }
  const result = await ended;
  shutdownClient(result.ok ? 0 : 1);
} else {
  let currentStream = client.request(requestHeaders(accessToken));
  let currentEnded = attachStream(currentStream);

  currentEnded.then((result) => {
    if (!result.ok) {
      shutdownClient(1);
      return;
    }
    if (!persistent) {
      shutdownClient(0);
      return;
    }
    writeMessage(STREAM_DONE_MAGIC);
    currentStream = null;
  });

  (async () => {
    while (true) {
      const msg = await readMessage();
      if (!msg) {
        shutdownClient(0);
        return;
      }
      if (msg.length === 0) {
        if (currentStream && !currentStream.closed && !currentStream.destroyed) {
          currentStream.end();
        }
        if (!persistent) {
          shutdownClient(0);
          return;
        }
        continue;
      }

      const open = parseOpenCommand(msg);
      if (open) {
        if (client.destroyed || client.closed) {
          process.stderr.write("[h2-bridge] cannot open stream: client closed\n");
          shutdownClient(1);
          return;
        }
        const token = typeof open.accessToken === "string" && open.accessToken ? open.accessToken : accessToken;
        currentStream = client.request(requestHeaders(token));
        currentEnded = attachStream(currentStream);
        currentEnded.then((result) => {
          if (!result.ok) {
            shutdownClient(1);
            return;
          }
          writeMessage(STREAM_DONE_MAGIC);
          currentStream = null;
        });
        continue;
      }

      if (currentStream && !currentStream.closed && !currentStream.destroyed) {
        resetTimeout();
        if (!currentStream.write(msg)) {
          try {
            await once(currentStream, "drain");
          } catch {
            break;
          }
        }
      }
      // Idle leftover heartbeats (after STREAM_DONE, before the next open) are ignored.
    }
  })();
}
