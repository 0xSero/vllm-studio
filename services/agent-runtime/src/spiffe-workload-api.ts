import {
  credentials,
  makeGenericClientConstructor,
  Metadata,
  status,
  type Client,
  type ClientReadableStream,
  type ClientUnaryCall,
  type ServiceError,
} from "@grpc/grpc-js";
import protobufjs, { type Type as ProtobufType } from "protobufjs";
import type { WorkloadIdentityConfig } from "@local-studio/contracts/workload-identity";

type JwtSvid = { spiffe_id: string; svid: string; hint?: string };
type FetchResponse = { svids?: JwtSvid[] };
type ValidateResponse = { spiffe_id?: string; claims?: Record<string, unknown> };
export type WorkloadX509Svid = {
  spiffe_id: string;
  x509_svid: Buffer;
  x509_svid_key: Buffer;
  bundle: Buffer;
  hint?: string;
};
export type WorkloadX509Response = {
  svids?: WorkloadX509Svid[];
  crl?: Buffer[];
  federated_bundles?: Record<string, Buffer>;
};
type UnaryCallback<T> = (error: ServiceError | null, response: T) => void;
type WorkloadClient = Client & {
  FetchJWTSVID(
    request: { audience: string[]; spiffe_id: string },
    metadata: Metadata,
    options: { deadline: Date },
    callback: UnaryCallback<FetchResponse>,
  ): ClientUnaryCall;
  ValidateJWTSVID(
    request: { audience: string; svid: string },
    metadata: Metadata,
    options: { deadline: Date },
    callback: UnaryCallback<ValidateResponse>,
  ): ClientUnaryCall;
  FetchX509SVID(
    request: Record<string, never>,
    metadata: Metadata,
  ): ClientReadableStream<WorkloadX509Response>;
};

export const isWorkloadApiUnavailable = (error: unknown): boolean =>
  typeof error === "object" &&
  error !== null &&
  "code" in error &&
  [status.UNAVAILABLE, status.DEADLINE_EXCEEDED].includes((error as { code: number }).code);

const { Field, MapField, Root, Type } = protobufjs;
const root = new Root();
const jwtSvid = new Type("JWTSVID")
  .add(new Field("spiffe_id", 1, "string"))
  .add(new Field("svid", 2, "string"))
  .add(new Field("hint", 3, "string"));
const fetchRequest = new Type("JWTSVIDRequest")
  .add(new Field("audience", 1, "string", "repeated"))
  .add(new Field("spiffe_id", 2, "string"));
const fetchResponse = new Type("JWTSVIDResponse").add(new Field("svids", 1, "JWTSVID", "repeated"));
const validateRequest = new Type("ValidateJWTSVIDRequest")
  .add(new Field("audience", 1, "string"))
  .add(new Field("svid", 2, "string"));
const validateResponse = new Type("ValidateJWTSVIDResponse").add(
  new Field("spiffe_id", 1, "string"),
);
const x509Svid = new Type("X509SVID")
  .add(new Field("spiffe_id", 1, "string"))
  .add(new Field("x509_svid", 2, "bytes"))
  .add(new Field("x509_svid_key", 3, "bytes"))
  .add(new Field("bundle", 4, "bytes"))
  .add(new Field("hint", 5, "string"));
const x509Request = new Type("X509SVIDRequest");
const x509Response = new Type("X509SVIDResponse")
  .add(new Field("svids", 1, "X509SVID", "repeated"))
  .add(new Field("crl", 2, "bytes", "repeated"))
  .add(new MapField("federated_bundles", 3, "string", "bytes"));
root
  .add(jwtSvid)
  .add(fetchRequest)
  .add(fetchResponse)
  .add(validateRequest)
  .add(validateResponse)
  .add(x509Svid)
  .add(x509Request)
  .add(x509Response);
root.resolveAll();

const serialize =
  (type: ProtobufType) =>
  (value: unknown): Buffer =>
    Buffer.from(type.encode(type.fromObject(value as Record<string, unknown>)).finish());
const deserialize =
  (type: ProtobufType) =>
  (value: Buffer): unknown =>
    type.toObject(type.decode(value), { defaults: true, arrays: true, objects: true });
export const spiffeWorkloadServiceDefinition = {
  FetchX509SVID: {
    path: "/SpiffeWorkloadAPI/FetchX509SVID",
    requestStream: false,
    responseStream: true,
    requestSerialize: serialize(x509Request),
    requestDeserialize: deserialize(x509Request),
    responseSerialize: serialize(x509Response),
    responseDeserialize: deserialize(x509Response),
  },
  FetchJWTSVID: {
    path: "/SpiffeWorkloadAPI/FetchJWTSVID",
    requestStream: false,
    responseStream: false,
    requestSerialize: serialize(fetchRequest),
    requestDeserialize: deserialize(fetchRequest),
    responseSerialize: serialize(fetchResponse),
    responseDeserialize: deserialize(fetchResponse),
  },
  ValidateJWTSVID: {
    path: "/SpiffeWorkloadAPI/ValidateJWTSVID",
    requestStream: false,
    responseStream: false,
    requestSerialize: serialize(validateRequest),
    requestDeserialize: deserialize(validateRequest),
    responseSerialize: serialize(validateResponse),
    responseDeserialize: deserialize(validateResponse),
  },
};
const WorkloadApi = makeGenericClientConstructor(
  spiffeWorkloadServiceDefinition,
  "SpiffeWorkloadAPI",
);

const target = (endpoint: string): string => `unix:${new URL(endpoint).pathname}`;
const metadata = (): Metadata => {
  const value = new Metadata();
  value.set("workload.spiffe.io", "true");
  return value;
};
const deadline = (): { deadline: Date } => ({ deadline: new Date(Date.now() + 3_000) });

const unary = <T>(
  invoke: (callback: UnaryCallback<T>) => ClientUnaryCall,
  signal?: AbortSignal,
): Promise<T> =>
  new Promise((resolve, reject) => {
    let call: ClientUnaryCall;
    const aborted = (): void => {
      call.cancel();
      reject(signal?.reason);
    };
    call = invoke((error, response) => {
      signal?.removeEventListener("abort", aborted);
      if (error) reject(error);
      else resolve(response);
    });
    if (!signal) return;
    if (signal.aborted) {
      aborted();
      return;
    }
    signal.addEventListener("abort", aborted, { once: true });
  });

const clientFor = (config: WorkloadIdentityConfig): WorkloadClient =>
  new WorkloadApi(
    target(config.endpoint),
    credentials.createInsecure(),
  ) as unknown as WorkloadClient;

export const fetchJwtSvid = async (
  config: WorkloadIdentityConfig,
  audience: string,
  spiffeId: string,
  signal?: AbortSignal,
): Promise<JwtSvid> => {
  const client = clientFor(config);
  try {
    const response = await unary<FetchResponse>(
      (callback) =>
        client.FetchJWTSVID(
          { audience: [audience], spiffe_id: spiffeId },
          metadata(),
          deadline(),
          callback,
        ),
      signal,
    );
    const selected = response.svids?.find((entry) => entry.spiffe_id === spiffeId);
    if (!selected?.svid || selected.svid.length > 64 * 1024) {
      throw new Error("SPIFFE Workload API returned no admitted JWT-SVID");
    }
    return selected;
  } finally {
    client.close();
  }
};

export const validateJwtSvid = async (
  config: WorkloadIdentityConfig,
  audience: string,
  token: string,
  admittedIds: readonly string[],
  signal?: AbortSignal,
): Promise<{ spiffeId: string; expiresAt: number | null }> => {
  const parts = token.split(".");
  if (parts.length !== 3 || token.length > 64 * 1024) throw new Error("JWT-SVID is invalid");
  const client = clientFor(config);
  try {
    const response = await unary<ValidateResponse>(
      (callback) =>
        client.ValidateJWTSVID({ audience, svid: token }, metadata(), deadline(), callback),
      signal,
    );
    const spiffeId = response.spiffe_id ?? "";
    if (!admittedIds.includes(spiffeId)) throw new Error("SPIFFE workload is not admitted");
    const payload = JSON.parse(Buffer.from(parts[1]!, "base64url").toString("utf8")) as {
      sub?: unknown;
      aud?: unknown;
      exp?: unknown;
    };
    const audiences =
      typeof payload.aud === "string"
        ? [payload.aud]
        : Array.isArray(payload.aud)
          ? payload.aud.filter((value): value is string => typeof value === "string")
          : [];
    if (
      payload.sub !== spiffeId ||
      !audiences.includes(audience) ||
      !Number.isSafeInteger(payload.exp) ||
      (payload.exp as number) <= Math.floor(Date.now() / 1000)
    ) {
      throw new Error("Validated JWT-SVID claims are invalid");
    }
    return {
      spiffeId,
      expiresAt: payload.exp as number,
    };
  } finally {
    client.close();
  }
};

export const streamX509Svid = (
  config: WorkloadIdentityConfig,
  onSnapshot: (response: WorkloadX509Response) => void,
  onError: (error: Error) => void,
): (() => void) => {
  const client = clientFor(config);
  const call = client.FetchX509SVID({}, metadata());
  call.on("data", onSnapshot);
  call.on("error", onError);
  call.on("end", () => onError(new Error("SPIFFE Workload API X.509 stream ended")));
  return () => {
    call.cancel();
    client.close();
  };
};
