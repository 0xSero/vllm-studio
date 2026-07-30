import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createServer as createHttpsServer } from "node:https";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, test } from "node:test";
import {
  materializeX509Svid,
  spiffeFetch,
  spiffeServerTlsOptions,
  validateX509Peer,
  validateX509PeerSocket,
  validateX509RequestProof,
} from "../src/spiffe-x509";

const directory = mkdtempSync(join(tmpdir(), "spiffe-x509-"));
const frontendId = "spiffe://example.org/ns/studio/sa/frontend";
const runtimeId = "spiffe://example.org/ns/studio/sa/agent-runtime";

const certificateMaterial = (
  name: string,
  identity = frontendId,
  additionalSan = "",
): { certificate: Buffer; key: Buffer; bundle: Buffer } => {
  const prefix = join(directory, name);
  const caKey = join(directory, "ca.key");
  const caPem = join(directory, "ca.pem");
  if (!existsSync(caPem)) {
    execFileSync("openssl", [
      "req",
      "-x509",
      "-newkey",
      "rsa:2048",
      "-nodes",
      "-keyout",
      caKey,
      "-out",
      caPem,
      "-subj",
      "/CN=SPIFFE Test CA",
      "-days",
      "1",
    ]);
  }
  writeFileSync(
    `${prefix}.ext`,
    `basicConstraints=critical,CA:FALSE\nkeyUsage=critical,digitalSignature,keyEncipherment\nextendedKeyUsage=clientAuth,serverAuth\nsubjectAltName=URI:${identity}${additionalSan}\n`,
  );
  execFileSync("openssl", [
    "req",
    "-newkey",
    "rsa:2048",
    "-nodes",
    "-keyout",
    `${prefix}.key`,
    "-out",
    `${prefix}.csr`,
    "-subj",
    `/CN=${name}`,
  ]);
  execFileSync("openssl", [
    "x509",
    "-req",
    "-in",
    `${prefix}.csr`,
    "-CA",
    caPem,
    "-CAkey",
    caKey,
    "-CAcreateserial",
    "-out",
    `${prefix}.pem`,
    "-days",
    "1",
    "-extfile",
    `${prefix}.ext`,
  ]);
  execFileSync("openssl", ["x509", "-in", `${prefix}.pem`, "-outform", "DER", "-out", `${prefix}.der`]);
  execFileSync("openssl", [
    "pkcs8",
    "-topk8",
    "-nocrypt",
    "-in",
    `${prefix}.key`,
    "-outform",
    "DER",
    "-out",
    `${prefix}.key.der`,
  ]);
  execFileSync("openssl", ["x509", "-in", caPem, "-outform", "DER", "-out", `${prefix}.ca.der`]);
  return {
    certificate: readFileSync(`${prefix}.der`),
    key: readFileSync(`${prefix}.key.der`),
    bundle: readFileSync(`${prefix}.ca.der`),
  };
};

after(() => rmSync(directory, { recursive: true, force: true }));

test("establishes mTLS only for an admitted X.509-SVID peer", async () => {
  const frontend = certificateMaterial("frontend");
  const runtime = certificateMaterial("runtime", runtimeId);
  const frontendSnapshot = materializeX509Svid(
    {
      spiffe_id: frontendId,
      x509_svid: frontend.certificate,
      x509_svid_key: frontend.key,
      bundle: frontend.bundle,
    },
    frontendId,
    1,
  );
  const runtimeSnapshot = materializeX509Svid(
    {
      spiffe_id: runtimeId,
      x509_svid: runtime.certificate,
      x509_svid_key: runtime.key,
      bundle: runtime.bundle,
    },
    runtimeId,
    1,
  );
  const https = createHttpsServer(
    spiffeServerTlsOptions(runtimeSnapshot),
    (request, response) => {
      const headers = new Headers();
      for (const [name, value] of Object.entries(request.headers)) {
        if (Array.isArray(value)) for (const entry of value) headers.append(name, entry);
        else if (value !== undefined) headers.set(name, value);
      }
      const proof = validateX509RequestProof(
        new Request(`https://runtime${request.url}`, { method: request.method, headers }),
        runtimeSnapshot,
        [frontendId],
      );
      assert.equal(proof, frontendId);
      response.end("admitted");
    },
  );
  await new Promise<void>((resolve) => https.listen(0, "127.0.0.1", resolve));
  const address = https.address();
  assert.equal(typeof address, "object");
  assert.notEqual(address, null);
  const response = await spiffeFetch(
    `https://127.0.0.1:${(address as { port: number }).port}`,
    { method: "GET" },
    frontendSnapshot,
    runtimeId,
  );
  assert.equal(await response.text(), "admitted");
  assert.throws(() => validateX509Peer(frontend.certificate, [runtimeId]), /not admitted/);
  assert.equal(
    validateX509PeerSocket(
      {
        authorized: true,
        getPeerX509Certificate: () => undefined,
        getPeerCertificate: () => ({
          ca: false,
          subjectaltname: `URI:${frontendId}`,
          valid_from: new Date(Date.now() - 60_000).toUTCString(),
          valid_to: new Date(Date.now() + 60_000).toUTCString(),
        }),
      } as never,
      [frontendId],
    ),
    frontendId,
  );
  assert.throws(() =>
    validateX509PeerSocket(
      {
        authorized: true,
        getPeerX509Certificate: () => undefined,
        getPeerCertificate: () => ({
          subjectaltname: `URI:${frontendId}`,
          valid_from: new Date(Date.now() - 60_000).toUTCString(),
          valid_to: new Date(Date.now() + 60_000).toUTCString(),
        }),
      } as never,
      [frontendId],
    ),
  );
  assert.throws(
    () =>
      validateX509PeerSocket(
        {
          authorized: true,
          getPeerX509Certificate: () => ({ raw: runtime.certificate }),
          getPeerCertificate: () => ({
            ca: false,
            subjectaltname: `URI:${frontendId}`,
            valid_from: new Date(Date.now() - 60_000).toUTCString(),
            valid_to: new Date(Date.now() + 60_000).toUTCString(),
          }),
        } as never,
        [frontendId],
      ),
    /not admitted/,
  );
  await new Promise<void>((resolve, reject) =>
    https.close((error) => (error ? reject(error) : resolve())),
  );
});

test("rejects mismatched key material and clears the supplied private key", () => {
  const certificate = certificateMaterial("mismatch-certificate");
  const key = certificateMaterial("mismatch-key");
  assert.throws(
    () =>
      materializeX509Svid(
        {
          spiffe_id: frontendId,
          x509_svid: certificate.certificate,
          x509_svid_key: key.key,
          bundle: certificate.bundle,
        },
        frontendId,
        1,
      ),
    /does not match/,
  );
  assert.equal(key.key.every((value) => value === 0), true);
});

test("rejects a leaf carrying another subject alternative name", () => {
  const material = certificateMaterial("extra-san", frontendId, ",DNS:localhost");
  assert.throws(
    () =>
      materializeX509Svid(
        {
          spiffe_id: frontendId,
          x509_svid: material.certificate,
          x509_svid_key: material.key,
          bundle: material.bundle,
        },
        frontendId,
        1,
      ),
    /identity is invalid/,
  );
});
