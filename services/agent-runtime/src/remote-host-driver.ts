import { createHash, randomUUID } from "node:crypto";
import path from "node:path";
import type {
  RemoteAgentConfig,
  RemoteOwnedResource,
  RemoteProvisioningProfile,
} from "./remote-provisioning-contract";
import type { RemoteHostDriver } from "./remote-provisioning-adapters";
import type {
  RemoteConfigMutation,
  RemoteConnection,
  RemoteInspection,
} from "./remote-provisioning-port";
import {
  RemoteProcessError,
  runProcess,
  startProcess,
  type RunningProcess,
} from "./remote-process";
import { RemoteProvisioningError, requireContainedPath } from "./remote-provisioning-validation";

type ConnectionState = {
  profile: RemoteProvisioningProfile;
  target: string;
  boundary?: RunningProcess;
  credential?: string;
};

type DriverOptions = {
  sshBinary?: string;
  boundaryBinary?: string;
  timeoutMs?: number;
  maxOutputBytes?: number;
};

const REMOTE_PROGRAM = String.raw`
import hashlib,json,os,pathlib,shutil,subprocess,sys,tempfile,urllib.request
d=json.load(sys.stdin); op=d["op"]
def digest(p):
 h=hashlib.sha256()
 with open(p,"rb") as f:
  for b in iter(lambda:f.read(65536),b""): h.update(b)
 return "sha256:"+h.hexdigest()
def atomic_write(p,s):
 pathlib.Path(p).parent.mkdir(parents=True,exist_ok=True)
 fd,t=tempfile.mkstemp(prefix=".local-studio-",dir=str(pathlib.Path(p).parent))
 try:
  os.fchmod(fd,0o600)
  with os.fdopen(fd,"w") as f: f.write(s); f.flush(); os.fsync(f.fileno())
  os.replace(t,p)
 finally:
  if os.path.exists(t): os.unlink(t)
if op=="inspect":
 root=pathlib.Path(d["root"]); cur=root/"current"
 release=cur.resolve().name if cur.is_symlink() else None
 manifest=root/release/"manifest.json" if release else None
 print(json.dumps({"releaseId":release,"releaseDigest":digest(manifest) if manifest and manifest.is_file() else None,"agentDigests":{p:digest(p) if os.path.isfile(p) else None for p in d["agents"]},"services":{s:subprocess.run(["systemctl","is-active","--quiet",s]).returncode==0 for s in d["services"]}}))
elif op=="stage":
 p=pathlib.Path(d["path"]); cur=pathlib.Path(d["root"])/"current"; previous=str(cur.resolve()) if cur.is_symlink() else None
 p.mkdir(parents=True,exist_ok=False); atomic_write(str(p/"manifest.json"),d["manifest"])
 print(json.dumps({"path":str(p),"digest":digest(p/"manifest.json"),"previousRelease":previous}))
elif op=="activate":
 root=pathlib.Path(d["root"]); cur=root/"current"; previous=cur.resolve().name if cur.is_symlink() else None
 tmp=root/(".current-"+d["nonce"]); tmp.symlink_to(d["path"]); os.replace(tmp,cur)
 print(json.dumps({"previousRelease":previous}))
elif op=="restore-release":
 cur=pathlib.Path(d["root"])/"current"
 if d["previous"]:
  tmp=pathlib.Path(d["root"])/(".current-"+d["nonce"]); tmp.symlink_to(pathlib.Path(d["root"])/d["previous"]); os.replace(tmp,cur)
 elif cur.is_symlink(): cur.unlink()
 shutil.rmtree(d["path"],ignore_errors=True); print("{}")
elif op=="config":
 p=d["path"]; before=digest(p) if os.path.isfile(p) else None; backup=None
 if before:
  backup=p+".local-studio."+d["nonce"]+".bak"; shutil.copy2(p,backup)
 atomic_write(p,d["content"]); print(json.dumps({"path":p,"backupRef":backup,"beforeDigest":before,"afterDigest":digest(p),"operation":"updated" if before else "created"}))
elif op=="restore-config":
 if d.get("backup"):
  os.replace(d["backup"],d["path"])
 elif os.path.exists(d["path"]): os.unlink(d["path"])
 print("{}")
elif op=="restart":
 subprocess.run(["systemctl","restart","--",*d["services"]],check=True); print("{}")
elif op=="probe":
 req=urllib.request.Request(d["url"].rstrip("/")+"/v1/models",headers={"Authorization":"Bearer "+d["credential"]})
 with urllib.request.urlopen(req,timeout=8) as r: body=r.read(1048577)
 if len(body)>1048576: raise RuntimeError("response too large")
 value=json.loads(body); models=[x["id"] for x in value.get("data",[]) if isinstance(x,dict) and isinstance(x.get("id"),str)]
 print(json.dumps({"models":models,"fingerprint":hashlib.sha256(body).hexdigest()}))
elif op=="netbird":
 fd,t=tempfile.mkstemp(prefix=".netbird-setup-")
 try:
  os.fchmod(fd,0o600)
  with os.fdopen(fd,"w") as f: f.write(d["setupKey"]); f.flush(); os.fsync(f.fileno())
  subprocess.run(["netbird","up","--setup-key-file",t],check=True)
 finally:
  if os.path.exists(t): os.unlink(t)
 print("{}")
else: raise RuntimeError("unsupported operation")
`;

const parseJson = <A>(value: string): A => {
  try {
    return JSON.parse(value.trim()) as A;
  } catch {
    throw new RemoteProvisioningError(502, "Remote host returned invalid bounded JSON");
  }
};

const releasePath = (profile: RemoteProvisioningProfile): string =>
  path.posix.join(profile.release.root, profile.release.id);

export class ProductionRemoteHostDriver implements RemoteHostDriver {
  private readonly connections = new Map<string, ConnectionState>();
  private readonly sshBinary: string;
  private readonly boundaryBinary: string;
  private readonly timeoutMs: number;
  private readonly maxOutputBytes: number;

  constructor(options: DriverOptions = {}) {
    this.sshBinary = options.sshBinary ?? "ssh";
    this.boundaryBinary = options.boundaryBinary ?? "boundary";
    this.timeoutMs = options.timeoutMs ?? 15_000;
    this.maxOutputBytes = options.maxOutputBytes ?? 1_048_576;
  }

  async inspect(profile: RemoteProvisioningProfile, credential: string): Promise<RemoteInspection> {
    const connection = await this.connect(profile, credential);
    try {
      return await this.remote<RemoteInspection>(connection, {
        op: "inspect",
        root: profile.release.root,
        agents: profile.agents.map((agent) => agent.configPath),
        services: [...profile.release.services],
      });
    } finally {
      await this.close(connection);
    }
  }

  async connect(profile: RemoteProvisioningProfile, credential: string): Promise<RemoteConnection> {
    const id = randomUUID();
    if (profile.access.kind === "direct-ssh") {
      const connection: RemoteConnection = {
        kind: "direct-ssh",
        id,
        hostKeyVerified: true,
        knownHostsPath: profile.access.knownHostsPath,
        hostKeyAlias: profile.access.hostKeyAlias,
      };
      this.connections.set(id, { profile, target: profile.access.sshTarget });
      await this.remote(connection, {
        op: "inspect",
        root: profile.release.root,
        agents: [],
        services: [],
      });
      return connection;
    }
    if (!credential) throw new RemoteProvisioningError(401, "Boundary credential is unavailable");
    const authorization = await this.authorizeBoundary(profile, credential);
    const boundary = startProcess({
      file: this.boundaryBinary,
      args: [
        "connect",
        "-listen-addr",
        "127.0.0.1",
        "-listen-port",
        "0",
        "-authz-token",
        "-",
        "-format",
        "json",
      ],
      stdin: authorization.authorizationToken,
      timeoutMs: 86_400_000,
      maxOutputBytes: this.maxOutputBytes,
      env: { BOUNDARY_ADDR: profile.access.controllerUrl },
    });
    const started = await this.awaitBoundary(boundary);
    const connection: RemoteConnection = {
      kind: "boundary",
      id,
      sessionId: authorization.sessionId,
      hostKeyVerified: true,
      knownHostsPath: profile.access.knownHostsPath,
      hostKeyAlias: profile.access.hostKeyAlias,
    };
    this.connections.set(id, {
      profile,
      target: `127.0.0.1:${started.port}`,
      boundary,
      credential,
    });
    await this.remote(connection, {
      op: "inspect",
      root: profile.release.root,
      agents: [],
      services: [],
    });
    return connection;
  }

  async close(
    connection: RemoteConnection,
  ): Promise<{ closed: boolean; sessionCancelled?: boolean }> {
    const state = this.connections.get(connection.id);
    this.connections.delete(connection.id);
    if (!state?.boundary) return { closed: true };
    if (connection.sessionId && state.credential) {
      await this.cancelBoundarySession(state.profile, state.credential, connection.sessionId);
    }
    await state.boundary.stop().catch(() => undefined);
    return { closed: true, sessionCancelled: Boolean(connection.sessionId) };
  }

  async cancelBoundarySession(
    profile: RemoteProvisioningProfile,
    credential: string,
    sessionId: string,
  ): Promise<void> {
    if (profile.access.kind !== "boundary") return;
    const url = new URL(
      `/v1/sessions/${encodeURIComponent(sessionId)}:cancel`,
      profile.access.controllerUrl,
    );
    const sessionUrl = new URL(
      `/v1/sessions/${encodeURIComponent(sessionId)}`,
      profile.access.controllerUrl,
    );
    const headers = {
      Accept: "application/json",
      Authorization: `Bearer ${credential}`,
    };
    const sessionResponse = await fetch(sessionUrl, {
      headers,
      redirect: "error",
      signal: AbortSignal.timeout(this.timeoutMs),
    });
    if (sessionResponse.status === 404) return;
    const sessionText = await sessionResponse.text();
    if (
      !sessionResponse.ok ||
      new TextEncoder().encode(sessionText).byteLength > this.maxOutputBytes
    ) {
      throw new RemoteProvisioningError(
        sessionResponse.ok ? 502 : sessionResponse.status,
        "Boundary session read failed before cancellation",
      );
    }
    const session = parseJson<{ version?: number; item?: { version?: number; status?: string } }>(
      sessionText,
    );
    const version = session.version ?? session.item?.version;
    if (session.item?.status === "terminated") return;
    if (!Number.isSafeInteger(version) || Number(version) < 1) {
      throw new RemoteProvisioningError(502, "Boundary session version evidence is incomplete");
    }
    const response = await fetch(url, {
      method: "POST",
      headers: { ...headers, "Content-Type": "application/json" },
      body: JSON.stringify({ version }),
      redirect: "error",
      signal: AbortSignal.timeout(this.timeoutMs),
    });
    if (!response.ok && response.status !== 404) {
      throw new RemoteProvisioningError(response.status, "Boundary session cancellation failed");
    }
  }

  async enrollNetbird(
    _profile: RemoteProvisioningProfile,
    setupKey: string,
    connection: RemoteConnection,
  ): Promise<void> {
    await this.remote(connection, { op: "netbird", setupKey });
  }

  async stageRelease(profile: RemoteProvisioningProfile, connection: RemoteConnection) {
    const target = releasePath(profile);
    requireContainedPath(profile.release.root, target, "Release path");
    const result = await this.remote<{
      path: string;
      digest: string;
      previousRelease: string | null;
    }>(connection, {
      op: "stage",
      path: target,
      root: profile.release.root,
      manifest: profile.release.manifest,
    });
    if (result.digest !== profile.release.checksum) {
      throw new RemoteProvisioningError(409, "Staged release checksum does not match");
    }
    return result;
  }

  async activateRelease(
    profile: RemoteProvisioningProfile,
    connection: RemoteConnection,
    target: string,
  ): Promise<void> {
    requireContainedPath(profile.release.root, target, "Release path");
    await this.remote(connection, {
      op: "activate",
      root: profile.release.root,
      path: target,
      nonce: randomUUID(),
    });
  }

  async restoreRelease(
    profile: RemoteProvisioningProfile,
    connection: RemoteConnection,
    resource: Extract<RemoteOwnedResource, { kind: "release" }>,
  ): Promise<void> {
    await this.remote(connection, {
      op: "restore-release",
      root: profile.release.root,
      path: resource.path,
      previous: resource.previousRelease,
      nonce: randomUUID(),
    });
  }

  async applyAgentConfig(
    profile: RemoteProvisioningProfile,
    connection: RemoteConnection,
    agent: RemoteAgentConfig,
  ): Promise<RemoteConfigMutation> {
    requireContainedPath(profile.agentRoot, agent.configPath, "Agent configuration path");
    return this.remote(connection, {
      op: "config",
      path: agent.configPath,
      content: agent.content,
      nonce: randomUUID(),
    });
  }

  async restoreAgentConfig(
    _profile: RemoteProvisioningProfile,
    connection: RemoteConnection,
    resource: Extract<RemoteOwnedResource, { kind: "agent-config" }>,
  ): Promise<void> {
    await this.remote(connection, {
      op: "restore-config",
      path: resource.path,
      backup: resource.backupRef,
    });
  }

  async restartServices(
    profile: RemoteProvisioningProfile,
    connection: RemoteConnection,
  ): Promise<void> {
    await this.remote(connection, { op: "restart", services: [...profile.release.services] });
  }

  probe(
    profile: RemoteProvisioningProfile,
    connection: RemoteConnection,
    inferenceCredential: string,
  ): Promise<{ models: string[]; fingerprint: string }> {
    return this.remote(connection, {
      op: "probe",
      url: profile.inference.baseUrl,
      credential: inferenceCredential,
    });
  }

  private async remote<A>(connection: RemoteConnection, payload: object): Promise<A> {
    const state = this.connections.get(connection.id);
    if (!state) throw new RemoteProvisioningError(409, "Remote connection is not active");
    const access = state.profile.access;
    const targetArgs =
      connection.kind === "boundary"
        ? ["-p", state.target.split(":").at(-1)!, "127.0.0.1"]
        : [state.target];
    try {
      const result = await runProcess({
        file: this.sshBinary,
        args: [
          "-T",
          "-o",
          "BatchMode=yes",
          "-o",
          "StrictHostKeyChecking=yes",
          "-o",
          `UserKnownHostsFile=${access.knownHostsPath}`,
          "-o",
          `HostKeyAlias=${access.hostKeyAlias}`,
          "-o",
          `ConnectTimeout=${Math.max(1, Math.floor(this.timeoutMs / 1000))}`,
          ...targetArgs,
          "python3",
          "-c",
          REMOTE_PROGRAM,
        ],
        stdin: JSON.stringify(payload),
        timeoutMs: this.timeoutMs,
        maxOutputBytes: this.maxOutputBytes,
      });
      return parseJson<A>(result.stdout);
    } catch (error) {
      if (
        error instanceof RemoteProcessError &&
        /host key verification failed/iu.test(error.result?.stderr ?? "")
      ) {
        throw new RemoteProvisioningError(409, "Pinned remote host-key verification failed");
      }
      throw error;
    }
  }

  private awaitBoundary(boundary: RunningProcess): Promise<{ port: number }> {
    return new Promise((resolve, reject) => {
      let output = "";
      const timer = setTimeout(
        () => {
          boundary.process.kill("SIGKILL");
          reject(new RemoteProvisioningError(504, "Boundary session startup timed out"));
        },
        Math.min(this.timeoutMs, 10_000),
      );
      const inspect = (chunk: Buffer) => {
        output += chunk.toString("utf8");
        const port = output.match(/"(?:listen_)?port"\s*:\s*"?(\d+)"?/u)?.[1];
        if (port) {
          clearTimeout(timer);
          resolve({ port: Number(port) });
        }
      };
      boundary.process.stdout.on("data", inspect);
      boundary.process.stderr.on("data", inspect);
      boundary.completion.catch((error) => {
        clearTimeout(timer);
        reject(error);
      });
    });
  }

  private async authorizeBoundary(
    profile: RemoteProvisioningProfile,
    credential: string,
  ): Promise<{ authorizationToken: string; sessionId: string }> {
    if (profile.access.kind !== "boundary") {
      throw new RemoteProvisioningError(409, "Boundary access profile is unavailable");
    }
    const url = new URL(
      `/v1/targets/${encodeURIComponent(profile.access.targetId)}:authorize-session`,
      profile.access.controllerUrl,
    );
    const response = await fetch(url, {
      method: "POST",
      headers: {
        Accept: "application/json",
        Authorization: `Bearer ${credential}`,
        "Content-Type": "application/json",
      },
      body: "{}",
      redirect: "error",
      signal: AbortSignal.timeout(this.timeoutMs),
    });
    const text = await response.text();
    if (!response.ok || new TextEncoder().encode(text).byteLength > this.maxOutputBytes) {
      throw new RemoteProvisioningError(
        response.ok ? 502 : response.status,
        "Boundary session authorization failed",
      );
    }
    const payload = parseJson<{
      authorization_token?: string;
      session_id?: string;
      item?: { authorization_token?: string; session_id?: string };
    }>(text);
    const authorizationToken = payload.authorization_token ?? payload.item?.authorization_token;
    const sessionId = payload.session_id ?? payload.item?.session_id;
    if (!authorizationToken || !sessionId || !/^s_[A-Za-z0-9]+$/u.test(sessionId)) {
      throw new RemoteProvisioningError(502, "Boundary authorization evidence is incomplete");
    }
    return { authorizationToken, sessionId };
  }
}

export const createProductionRemoteHostDriver = (options?: DriverOptions): RemoteHostDriver =>
  new ProductionRemoteHostDriver(options);
