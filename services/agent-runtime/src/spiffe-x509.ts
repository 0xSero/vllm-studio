import { X509Certificate, createPrivateKey, createPublicKey, randomUUID, sign, verify } from "node:crypto";
import type { ClientRequest, IncomingMessage } from "node:http";
import { request as httpsRequest, type RequestOptions } from "node:https";
import { Readable } from "node:stream";
import type { SecureContextOptions, TLSSocket } from "node:tls";
import type { WorkloadIdentityConfig } from "@local-studio/contracts/workload-identity";
import {
  streamX509Svid,
  type WorkloadX509Response,
  type WorkloadX509Svid,
} from "./spiffe-workload-api";

export type X509SvidSnapshot = {
  spiffeId: string;
  certificatePem: Buffer;
  privateKeyPem: Buffer;
  bundlePem: Buffer;
  serialNumber: string;
  expiresAt: string;
  generation: number;
  certificateDer: Buffer[];
  bundleDer: Buffer[];
};

const derObjects = (input: Buffer): Buffer[] => {
  const values: Buffer[] = [];
  let offset = 0;
  while (offset < input.length) {
    if (input[offset] !== 0x30 || offset + 2 > input.length) {
      throw new Error("X.509 DER sequence is invalid");
    }
    const firstLength = input[offset + 1]!;
    let header = 2;
    let length = firstLength;
    if ((firstLength & 0x80) !== 0) {
      const count = firstLength & 0x7f;
      if (count === 0 || count > 4 || offset + 2 + count > input.length) {
        throw new Error("X.509 DER length is invalid");
      }
      header += count;
      length = 0;
      for (let index = 0; index < count; index += 1) {
        length = length * 256 + input[offset + 2 + index]!;
      }
    }
    const end = offset + header + length;
    if (end > input.length) throw new Error("X.509 DER value is truncated");
    values.push(input.subarray(offset, end));
    offset = end;
  }
  if (values.length === 0) throw new Error("X.509 DER sequence is empty");
  return values;
};

const pem = (label: string, der: Buffer): string => {
  const encoded =
    der
      .toString("base64")
      .match(/.{1,64}/gu)
      ?.join("\n") ?? "";
  return `-----BEGIN ${label}-----\n${encoded}\n-----END ${label}-----\n`;
};

const uriSans = (subjectAltName: string): string[] => {
  const values = subjectAltName.split(/,\s*/u);
  if (values.length !== 1 || !values[0]?.startsWith("URI:")) return [];
  return [values[0].slice(4)];
};

const validateLeaf = (leaf: Buffer, expectedId: string): X509Certificate => {
  const certificate = new X509Certificate(leaf);
  const identities = uriSans(certificate.subjectAltName ?? "");
  if (certificate.ca || identities.length !== 1 || identities[0] !== expectedId) {
    throw new Error("X.509-SVID identity is invalid");
  }
  const now = Date.now();
  if (Date.parse(certificate.validFrom) > now || Date.parse(certificate.validTo) <= now) {
    throw new Error("X.509-SVID lifetime is invalid");
  }
  return certificate;
};

export const materializeX509Svid = (
  value: WorkloadX509Svid,
  expectedId: string,
  generation: number,
): X509SvidSnapshot => {
  if (
    value.spiffe_id !== expectedId ||
    value.x509_svid.length > 1024 * 1024 ||
    value.x509_svid_key.length > 64 * 1024 ||
    value.bundle.length > 1024 * 1024
  ) {
    throw new Error("X.509-SVID response is invalid");
  }
  const certificates = derObjects(Buffer.from(value.x509_svid));
  const bundle = derObjects(Buffer.from(value.bundle));
  const leaf = validateLeaf(certificates[0]!, expectedId);
  const privateKeyDer = Buffer.from(value.x509_svid_key);
  try {
    const key = createPrivateKey({ key: privateKeyDer, format: "der", type: "pkcs8" });
    const certificateKey = leaf.publicKey.export({ format: "der", type: "spki" });
    const suppliedKey = createPublicKey(key).export({ format: "der", type: "spki" });
    if (!Buffer.from(certificateKey).equals(Buffer.from(suppliedKey))) {
      throw new Error("X.509-SVID private key does not match its certificate");
    }
    const privateKey = key.export({ format: "pem", type: "pkcs8" });
    return {
      spiffeId: expectedId,
      certificatePem: Buffer.from(certificates.map((entry) => pem("CERTIFICATE", entry)).join("")),
      privateKeyPem: Buffer.isBuffer(privateKey) ? privateKey : Buffer.from(privateKey),
      bundlePem: Buffer.from(bundle.map((entry) => pem("CERTIFICATE", entry)).join("")),
      serialNumber: leaf.serialNumber,
      expiresAt: new Date(leaf.validTo).toISOString(),
      generation,
      certificateDer: certificates.map((entry) => Buffer.from(entry)),
      bundleDer: bundle.map((entry) => Buffer.from(entry)),
    };
  } finally {
    privateKeyDer.fill(0);
    value.x509_svid_key.fill(0);
  }
};

const erase = (snapshot: X509SvidSnapshot | null): void => {
  snapshot?.privateKeyPem.fill(0);
};

export class X509SvidSource {
  private snapshotValue: X509SvidSnapshot | null = null;
  private generation = 0;
  private stopped = false;
  private cancelStream: (() => void) | null = null;
  private retry: ReturnType<typeof setTimeout> | null = null;
  private expiry: ReturnType<typeof setTimeout> | null = null;
  private readonly listeners = new Set<(snapshot: X509SvidSnapshot | null) => void>();

  constructor(
    private readonly config: WorkloadIdentityConfig,
    private readonly identity: string,
  ) {}

  get snapshot(): X509SvidSnapshot | null {
    return this.snapshotValue;
  }

  start(): void {
    if (this.stopped || this.cancelStream) return;
    this.connect();
  }

  stop(): void {
    this.stopped = true;
    this.cancelStream?.();
    this.cancelStream = null;
    if (this.retry) clearTimeout(this.retry);
    this.retry = null;
    if (this.expiry) clearTimeout(this.expiry);
    this.expiry = null;
    erase(this.snapshotValue);
    this.snapshotValue = null;
  }

  subscribe(listener: (snapshot: X509SvidSnapshot | null) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  ready(timeoutMs = 5_000): Promise<X509SvidSnapshot> {
    if (this.snapshotValue && Date.parse(this.snapshotValue.expiresAt) > Date.now()) {
      return Promise.resolve(this.snapshotValue);
    }
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        unsubscribe();
        reject(new Error("X.509-SVID readiness timed out"));
      }, timeoutMs);
      const unsubscribe = this.subscribe((snapshot) => {
        if (!snapshot) return;
        clearTimeout(timeout);
        unsubscribe();
        resolve(snapshot);
      });
    });
  }

  private publish(response: WorkloadX509Response): void {
    const selected = response.svids?.find((entry) => entry.spiffe_id === this.identity);
    const next = selected
      ? materializeX509Svid(selected, this.identity, this.generation + 1)
      : null;
    const previous = this.snapshotValue;
    this.snapshotValue = next;
    this.generation += 1;
    erase(previous);
    if (this.expiry) clearTimeout(this.expiry);
    this.expiry = null;
    if (next) {
      const remaining = Date.parse(next.expiresAt) - Date.now();
      this.expiry = setTimeout(() => {
        if (this.snapshotValue !== next) return;
        erase(next);
        this.snapshotValue = null;
        for (const listener of this.listeners) listener(null);
      }, Math.max(remaining, 0));
    }
    for (const listener of this.listeners) listener(next);
  }

  private connect(): void {
    let completed = false;
    const reconnect = (): void => {
      if (completed || this.stopped) return;
      completed = true;
      this.cancelStream?.();
      this.cancelStream = null;
      const delay = Math.min(250 * 2 ** Math.min(this.generation, 4), 4_000);
      this.retry = setTimeout(() => {
        this.retry = null;
        this.connect();
      }, delay);
    };
    this.cancelStream = streamX509Svid(
      this.config,
      (response) => {
        try {
          this.publish(response);
        } catch {
          if (this.expiry) clearTimeout(this.expiry);
          this.expiry = null;
          erase(this.snapshotValue);
          this.snapshotValue = null;
          for (const listener of this.listeners) listener(null);
        }
      },
      reconnect,
    );
  }
}

export const validateX509Peer = (raw: Buffer, admittedIds: readonly string[]): string => {
  const certificate = new X509Certificate(raw);
  const identities = uriSans(certificate.subjectAltName ?? "");
  const now = Date.now();
  if (
    certificate.ca ||
    identities.length !== 1 ||
    !admittedIds.includes(identities[0]!) ||
    Date.parse(certificate.validFrom) > now ||
    Date.parse(certificate.validTo) <= now
  ) {
    throw new Error("mTLS peer is not admitted");
  }
  return identities[0]!;
};

export const peerCertificateRaw = (socket: TLSSocket): Buffer => {
  const x509 =
    typeof socket.getPeerX509Certificate === "function"
      ? socket.getPeerX509Certificate()
      : undefined;
  if (x509?.raw?.length) return x509.raw;
  const legacy =
    typeof socket.getPeerCertificate === "function" ? socket.getPeerCertificate() : undefined;
  if (legacy?.raw?.length) return legacy.raw;
  throw new Error("mTLS peer certificate is missing");
};

export const validateX509PeerSocket = (
  socket: TLSSocket,
  admittedIds: readonly string[],
): string => {
  if (!socket.authorized) throw new Error("mTLS peer certificate is not authorized");
  const x509 =
    typeof socket.getPeerX509Certificate === "function"
      ? socket.getPeerX509Certificate()
      : undefined;
  if (x509?.raw?.length) return validateX509Peer(x509.raw, admittedIds);
  const peer =
    typeof socket.getPeerCertificate === "function"
      ? socket.getPeerCertificate()
      : undefined;
  if (peer?.raw?.length) return validateX509Peer(peer.raw, admittedIds);
  const identities = uriSans(peer?.subjectaltname ?? "");
  const now = Date.now();
  const validFrom = Date.parse(peer?.valid_from ?? "");
  const validTo = Date.parse(peer?.valid_to ?? "");
  if (
    peer?.ca !== false ||
    identities.length !== 1 ||
    !admittedIds.includes(identities[0]!) ||
    !Number.isFinite(validFrom) ||
    !Number.isFinite(validTo) ||
    validFrom > now ||
    validTo <= now
  ) {
    throw new Error("mTLS peer is not admitted");
  }
  return identities[0]!;
};

export const spiffeServerTlsOptions = (
  snapshot: X509SvidSnapshot,
): SecureContextOptions & {
  requestCert: true;
  rejectUnauthorized: true;
} => ({
  key: snapshot.privateKeyPem,
  cert: snapshot.certificatePem,
  ca: snapshot.bundlePem,
  requestCert: true,
  rejectUnauthorized: true,
  minVersion: "TLSv1.2",
});

const spiffeRequestOptions = (
  url: URL,
  init: RequestInit,
  snapshot: X509SvidSnapshot,
  expectedPeerId: string,
): RequestOptions => {
  const headers: Record<string, string> = {};
  new Headers(init.headers).forEach((value, name) => {
    headers[name] = value;
  });
  const timestamp = String(Date.now());
  const nonce = randomUUID();
  const payload = `${init.method ?? "GET"}\n${url.pathname}${url.search}\n${timestamp}\n${nonce}\n${headers["x-spiffe-jwt-svid"] ?? ""}`;
  headers["x-spiffe-x509-chain"] = Buffer.concat(snapshot.certificateDer).toString("base64");
  headers["x-spiffe-x509-time"] = timestamp;
  headers["x-spiffe-x509-nonce"] = nonce;
  headers["x-spiffe-x509-proof"] = sign(
    "sha256",
    Buffer.from(payload),
    snapshot.privateKeyPem,
  ).toString("base64");
  return {
    method: init.method,
    headers,
    key: snapshot.privateKeyPem,
    cert: snapshot.certificatePem,
    ca: snapshot.bundlePem,
    rejectUnauthorized: true,
    minVersion: "TLSv1.2",
    checkServerIdentity: (_hostname, peer) => {
      try {
        validateX509Peer(peer.raw, [expectedPeerId]);
        return undefined;
      } catch (error) {
        return error instanceof Error ? error : new Error("mTLS peer is invalid");
      }
    },
  };
};

export const validateX509RequestProof = (
  request: Request,
  bundle: X509SvidSnapshot,
  admittedIds: readonly string[],
): string => {
  const encoded = request.headers.get("x-spiffe-x509-chain") ?? "";
  const timestamp = request.headers.get("x-spiffe-x509-time") ?? "";
  const nonce = request.headers.get("x-spiffe-x509-nonce") ?? "";
  const signature = request.headers.get("x-spiffe-x509-proof") ?? "";
  if (encoded.length > 256_000 || Math.abs(Date.now() - Number(timestamp)) > 10_000) {
    throw new Error("X.509 request proof is invalid");
  }
  const chain = derObjects(Buffer.from(encoded, "base64"));
  const identity = validateX509Peer(chain[0]!, admittedIds);
  const certificates = chain.map((entry) => new X509Certificate(entry));
  for (let index = 0; index < certificates.length - 1; index += 1) {
    if (!certificates[index]!.verify(certificates[index + 1]!.publicKey)) {
      throw new Error("X.509 request proof chain is invalid");
    }
  }
  const issuer = certificates.at(-1)!;
  const trusted = bundle.bundleDer.some((entry) =>
    issuer.verify(new X509Certificate(entry).publicKey),
  );
  const payload = `${request.method}\n${new URL(request.url).pathname}${new URL(request.url).search}\n${timestamp}\n${nonce}\n${request.headers.get("x-spiffe-jwt-svid") ?? ""}`;
  if (
    !trusted ||
    !verify(
      "sha256",
      Buffer.from(payload),
      certificates[0]!.publicKey,
      Buffer.from(signature, "base64"),
    )
  ) {
    throw new Error("X.509 request proof is invalid");
  }
  return identity;
};

const webResponse = (response: IncomingMessage): Response => {
  const headers = new Headers();
  for (const [name, value] of Object.entries(response.headers)) {
    if (Array.isArray(value)) for (const entry of value) headers.append(name, entry);
    else if (value !== undefined) headers.set(name, value);
  }
  const init: ResponseInit = { status: response.statusCode ?? 502, headers };
  if (response.statusMessage) init.statusText = response.statusMessage;
  return new Response(
    Readable.toWeb(response) as unknown as ReadableStream<Uint8Array>,
    init,
  );
};

const endRequest = (request: ClientRequest, body: RequestInit["body"]): void => {
  if (body instanceof ArrayBuffer) request.end(Buffer.from(body));
  else if (ArrayBuffer.isView(body)) {
    request.end(Buffer.from(body.buffer, body.byteOffset, body.byteLength));
  } else if (typeof body === "string") request.end(body);
  else request.end();
};

export const spiffeFetch = (
  input: string,
  init: RequestInit,
  snapshot: X509SvidSnapshot,
  expectedPeerId: string,
): Promise<Response> =>
  new Promise((resolve, reject) => {
    const url = new URL(input);
    if (url.protocol !== "https:") {
      reject(new Error("SPIFFE mTLS requires HTTPS"));
      return;
    }
    const abort = (): void => {
      request.destroy(init.signal?.reason);
    };
    const cleanup = (): void => init.signal?.removeEventListener("abort", abort);
    const request = httpsRequest(
      url,
      spiffeRequestOptions(url, init, snapshot, expectedPeerId),
      (response) => {
        cleanup();
        resolve(webResponse(response));
      },
    );
    request.once("error", (error) => {
      cleanup();
      reject(error);
    });
    if (init.signal) {
      if (init.signal.aborted) {
        abort();
        return;
      }
      init.signal.addEventListener("abort", abort, { once: true });
    }
    endRequest(request, init.body);
  });

const sources = new Map<string, X509SvidSource>();

const sourceFor = (config: WorkloadIdentityConfig, identity: string): X509SvidSource => {
  const key = `${config.endpoint}\n${identity}`;
  let source = sources.get(key);
  if (!source) {
    source = new X509SvidSource(config, identity);
    sources.set(key, source);
    source.start();
  }
  return source;
};

export const currentX509Svid = (
  config: WorkloadIdentityConfig,
  identity: string,
): X509SvidSnapshot | null => {
  const snapshot = sourceFor(config, identity).snapshot;
  return snapshot && Date.parse(snapshot.expiresAt) > Date.now() ? snapshot : null;
};

export const readyX509Svid = (
  config: WorkloadIdentityConfig,
  identity: string,
): Promise<X509SvidSnapshot> => sourceFor(config, identity).ready();

export const fetchWithX509Svid = async (
  config: WorkloadIdentityConfig,
  identity: string,
  peerIdentity: string,
  input: string,
  init: RequestInit,
): Promise<Response> => {
  if (!config.x509_mtls || config.x509_mtls === "disabled") return fetch(input, init);
  const source = sourceFor(config, identity);
  try {
    const snapshot = await source.ready();
    return await spiffeFetch(input, init, snapshot, peerIdentity);
  } catch (error) {
    if (config.x509_mtls === "required") throw error;
    return fetch(input, init);
  }
};
