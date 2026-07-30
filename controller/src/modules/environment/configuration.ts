import { lstatSync, realpathSync, statSync } from "node:fs";
import { isAbsolute, relative, resolve } from "node:path";
import type { KubernetesConnectionConfig } from "@local-studio/contracts/environment-commissioning";

type CredentialKind = "token" | "ca";

type CredentialRoot = {
  id: "controller" | "kubernetes";
  path: string;
  allowSymlink: boolean;
  restrictiveTokenMode: boolean;
};

export type PreparedKubernetesConnection = {
  runtime: KubernetesConnectionConfig;
  persisted: KubernetesConnectionConfig;
  response: KubernetesConnectionConfig;
};

const configuredRoot = (dataDirectory: string): CredentialRoot => ({
  id: "controller",
  path: resolve(dataDirectory, "credentials"),
  allowSymlink: false,
  restrictiveTokenMode: true,
});

const kubernetesRoot = (): CredentialRoot => ({
  id: "kubernetes",
  path: "/var/run/secrets/kubernetes.io/serviceaccount",
  allowSymlink: true,
  restrictiveTokenMode: false,
});

const roots = (dataDirectory: string): CredentialRoot[] => [
  configuredRoot(dataDirectory),
  kubernetesRoot(),
];

const isContained = (root: string, candidate: string): boolean => {
  const child = relative(root, candidate);
  return child === "" || (!child.startsWith("..") && !isAbsolute(child));
};

const containedByRoot = (root: CredentialRoot, candidate: string): boolean => {
  try {
    return isContained(realpathSync(root.path), realpathSync(candidate));
  } catch {
    return isContained(resolve(root.path), resolve(candidate));
  }
};

const publicReference = (
  path: string,
  kind: CredentialKind,
  dataDirectory: string,
): string => {
  for (const root of roots(dataDirectory)) {
    if (!containedByRoot(root, path)) continue;
    const lexicalChild = relative(resolve(root.path), resolve(path));
    const child =
      !lexicalChild.startsWith("..") && !isAbsolute(lexicalChild)
        ? lexicalChild
        : relative(realpathSync(root.path), realpathSync(path));
    if (!child.startsWith("..") && !isAbsolute(child)) return `${root.id}:${child}`;
  }
  return `existing:${kind}`;
};

const pathFromReference = (
  reference: string,
  kind: CredentialKind,
  dataDirectory: string,
  currentPath: string | undefined,
): { path: string; root: CredentialRoot } => {
  const value = reference.trim();
  if (value === `existing:${kind}` && currentPath) {
    const matchingRoot = roots(dataDirectory).find((root) => containedByRoot(root, currentPath));
    if (matchingRoot) return { path: resolve(currentPath), root: matchingRoot };
    throw new Error(`Existing Kubernetes ${kind} reference cannot be commissioned`);
  }
  for (const root of roots(dataDirectory)) {
    const prefix = `${root.id}:`;
    if (!value.startsWith(prefix)) continue;
    const child = value.slice(prefix.length);
    if (!child || isAbsolute(child)) throw new Error(`Invalid Kubernetes ${kind} reference`);
    const path = resolve(root.path, child);
    if (!isContained(resolve(root.path), path)) {
      throw new Error(`Kubernetes ${kind} reference escapes its credential root`);
    }
    return { path, root };
  }
  if (!isAbsolute(value)) throw new Error(`Kubernetes ${kind} reference is invalid`);
  const matchingRoot = roots(dataDirectory).find((root) => containedByRoot(root, value));
  if (!matchingRoot) {
    throw new Error(
      `Kubernetes ${kind} must be stored under the controller credential root or projected service-account root`,
    );
  }
  return { path: resolve(value), root: matchingRoot };
};

const validateCredentialFile = (
  path: string,
  root: CredentialRoot,
  kind: CredentialKind,
): string => {
  let rootPath: string;
  let link;
  let canonicalPath: string;
  try {
    rootPath = realpathSync(root.path);
    link = lstatSync(path);
    canonicalPath = realpathSync(path);
  } catch {
    throw new Error(`Kubernetes ${kind} credential reference is unavailable`);
  }
  if (!root.allowSymlink && link.isSymbolicLink()) {
    throw new Error(`Kubernetes ${kind} credential cannot be a symbolic link`);
  }
  if (!isContained(rootPath, canonicalPath)) {
    throw new Error(`Kubernetes ${kind} credential escapes its credential root`);
  }
  const file = statSync(canonicalPath);
  if (!file.isFile()) throw new Error(`Kubernetes ${kind} credential must be a regular file`);
  if (
    kind === "token" &&
    root.restrictiveTokenMode &&
    process.platform !== "win32" &&
    (file.mode & 0o077) !== 0
  ) {
    throw new Error("Controller-owned Kubernetes token must not be group or world accessible");
  }
  return root.allowSymlink ? resolve(path) : canonicalPath;
};

export const normalizeKubernetesApiUrl = (value: string): string => {
  let endpoint: URL;
  try {
    endpoint = new URL(value.trim());
  } catch {
    throw new Error("Kubernetes API URL must be an absolute HTTP or HTTPS URL");
  }
  const loopback = ["localhost", "127.0.0.1", "::1"].includes(endpoint.hostname);
  if (endpoint.protocol !== "https:" && !(endpoint.protocol === "http:" && loopback)) {
    throw new Error("Kubernetes API URL must use HTTPS unless it targets loopback");
  }
  if (endpoint.username || endpoint.password) {
    throw new Error("Kubernetes API URL must not contain user information");
  }
  if (endpoint.search || endpoint.hash) {
    throw new Error("Kubernetes API URL must not contain a query or fragment");
  }
  if (endpoint.pathname !== "/" && endpoint.pathname !== "") {
    throw new Error("Kubernetes API URL must not contain a base path");
  }
  endpoint.pathname = "";
  return endpoint.toString().replace(/\/+$/u, "");
};

export const prepareKubernetesConnection = (
  input: KubernetesConnectionConfig,
  dataDirectory: string,
  current?: { apiUrl?: string; tokenFile?: string; caFile?: string },
): PreparedKubernetesConnection => {
  if (!input.enabled) {
    const disabled = { enabled: false, api_url: "", token_file: "", ca_file: null };
    return { runtime: disabled, persisted: disabled, response: disabled };
  }
  const apiUrl = normalizeKubernetesApiUrl(input.api_url);
  const preservingExistingToken = input.token_file.trim() === "existing:token";
  const preservingExistingCa = input.ca_file?.trim() === "existing:ca";
  if (
    (preservingExistingToken || preservingExistingCa) &&
    (!current?.apiUrl || normalizeKubernetesApiUrl(current.apiUrl) !== apiUrl)
  ) {
    throw new Error("Existing environment credentials cannot be redirected to another endpoint");
  }
  const tokenFile =
    preservingExistingToken && current?.tokenFile
      ? current.tokenFile
      : ((): string => {
          const candidate = pathFromReference(
            input.token_file,
            "token",
            dataDirectory,
            current?.tokenFile,
          );
          return validateCredentialFile(candidate.path, candidate.root, "token");
        })();
  const caFile =
    preservingExistingCa && current?.caFile
      ? current.caFile
      : input.ca_file
        ? ((): string => {
            const candidate = pathFromReference(
              input.ca_file,
              "ca",
              dataDirectory,
              current?.caFile,
            );
            return validateCredentialFile(candidate.path, candidate.root, "ca");
          })()
        : null;
  const runtime = {
    enabled: true,
    api_url: apiUrl,
    token_file: tokenFile,
    ca_file: caFile,
  };
  const response = {
    enabled: true,
    api_url: apiUrl,
    token_file: publicReference(tokenFile, "token", dataDirectory),
    ca_file: caFile ? publicReference(caFile, "ca", dataDirectory) : null,
  };
  return { runtime, persisted: response, response };
};

export const responseKubernetesConnection = (
  configuration: KubernetesConnectionConfig,
  dataDirectory: string,
): KubernetesConnectionConfig => ({
  ...configuration,
  token_file: configuration.token_file
    ? publicReference(configuration.token_file, "token", dataDirectory)
    : "",
  ca_file: configuration.ca_file
    ? publicReference(configuration.ca_file, "ca", dataDirectory)
    : null,
});
