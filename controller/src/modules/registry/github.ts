import { Effect, Schema } from "effect";
import { runCommandAsyncEffect } from "../../core/command";

export class GitHubError extends Schema.TaggedErrorClass<GitHubError>()("GitHubError", {
  operation: Schema.String,
  message: Schema.String,
  status: Schema.optional(Schema.Number),
  detail: Schema.optional(Schema.Unknown),
}) {}

export interface GitHubRepo {
  readonly full_name: string;
  readonly default_branch: string;
  readonly fork: boolean;
  readonly owner: { readonly login: string };
}

export interface GitHubPullRequest {
  readonly number: number;
  readonly html_url: string;
}

export interface GitHubClient {
  /** The token in use, without exposing its value. */
  readonly authenticated: () => boolean;
  readonly getRepo: (
    owner: string,
    repo: string,
  ) => Effect.Effect<GitHubRepo | null, GitHubError>;
  readonly getBranch: (
    owner: string,
    repo: string,
    branch: string,
  ) => Effect.Effect<{ readonly sha: string } | null, GitHubError>;
  readonly createFork: (owner: string, repo: string) => Effect.Effect<GitHubRepo, GitHubError>;
  readonly createBranch: (
    owner: string,
    repo: string,
    branch: string,
    sha: string,
  ) => Effect.Effect<void, GitHubError>;
  readonly putFile: (input: {
    readonly owner: string;
    readonly repo: string;
    readonly branch: string;
    readonly path: string;
    readonly content: string;
    readonly message: string;
  }) => Effect.Effect<void, GitHubError>;
  readonly createPull: (input: {
    readonly owner: string;
    readonly repo: string;
    readonly title: string;
    readonly head: string;
    readonly base: string;
    readonly body: string;
  }) => Effect.Effect<GitHubPullRequest, GitHubError>;
}

type FetchLike = typeof globalThis.fetch;

const tokenFromGhCli = (): Effect.Effect<string | null> =>
  runCommandAsyncEffect("gh", ["auth", "token"], { timeoutMs: 5_000 }).pipe(
    Effect.map((result) => {
      const token = result.status === 0 ? result.stdout.trim() : "";
      return token.length > 0 ? token : null;
    }),
    Effect.catch(() => Effect.succeed(null)),
  );

/** Explicit env token first, then an authenticated `gh` CLI. */
export const resolveGitHubToken = (): Effect.Effect<string | null> => {
  const fromEnvironment =
    process.env["LOCAL_AI_REGISTRY_GITHUB_TOKEN"]?.trim() ||
    process.env["GH_TOKEN"]?.trim() ||
    process.env["GITHUB_TOKEN"]?.trim();
  return fromEnvironment ? Effect.succeed(fromEnvironment) : tokenFromGhCli();
};

interface GitHubOptions {
  readonly token?: string | null;
  readonly apiBase?: string;
  readonly fetch?: FetchLike;
}

export const makeGitHubClient = (options: GitHubOptions = {}): Omit<GitHubClient, "authenticated"> & {
  readonly authenticated: () => boolean;
} => {
  const apiBase = (options.apiBase ?? "https://api.github.com").replace(/\/+$/, "");
  const doFetch = options.fetch ?? globalThis.fetch;
  let cachedToken: string | null | undefined = options.token === undefined ? undefined : options.token;

  const token = (): Effect.Effect<string | null> =>
    Effect.suspend(() => {
      if (cachedToken !== undefined) return Effect.succeed(cachedToken);
      return Effect.map(resolveGitHubToken(), (resolved) => {
        cachedToken = resolved;
        return resolved;
      });
    });

  const failure = (operation: string, message: string, source?: unknown): GitHubError =>
    source === undefined
      ? new GitHubError({ operation, message })
      : new GitHubError({ operation, message, detail: source });

  const request = (
    operation: string,
    path: string,
    init: RequestInit = {},
  ): Effect.Effect<{ readonly status: number; readonly body: unknown }, GitHubError> =>
    Effect.flatMap(
      token(),
      (authToken) => {
        if (!authToken) {
          return Effect.fail(
            new GitHubError({
              operation,
              message:
                "No GitHub credentials available; sign in with `gh auth login` or set GITHUB_TOKEN",
            }),
          );
        }
        return Effect.tryPromise({
          try: () =>
            doFetch(`${apiBase}${path}`, {
              ...init,
              signal: AbortSignal.timeout(30_000),
              headers: {
                Authorization: `Bearer ${authToken}`,
                Accept: "application/vnd.github+json",
                "X-GitHub-Api-Version": "2022-11-28",
                "Content-Type": "application/json",
                ...(init.headers ?? {}),
              },
            }),
          catch: (source: unknown) => failure(operation, "GitHub request failed", source),
        }).pipe(
          Effect.flatMap((response) =>
            Effect.tryPromise({
              try: () => response.text(),
              catch: (source: unknown) => failure(operation, "Could not read GitHub response", source),
            }).pipe(Effect.map((text) => ({ response, text }))),
          ),
          Effect.map(({ response, text }) => {
            let body: unknown = null;
            if (text.length > 0) {
              try {
                body = JSON.parse(text) as unknown;
              } catch {
                body = text;
              }
            }
            return { status: response.status, ok: response.ok, body, text };
          }),
          Effect.flatMap((result) => {
            if (result.ok) return Effect.succeed({ status: result.status, body: result.body });
            const detail =
              result.body !== null && typeof result.body === "object" && "message" in result.body
                ? String((result.body as { message: unknown }).message)
                : result.text.slice(0, 200);
            return Effect.fail(
              new GitHubError({
                operation,
                message: `GitHub returned HTTP ${result.status}${detail ? `: ${detail}` : ""}`,
                status: result.status,
                detail: result.body,
              }),
            );
          }),
        );
      },
    );

  const repoFrom = (body: unknown): GitHubRepo => {
    const record = body as {
      full_name?: string;
      default_branch?: string;
      fork?: boolean;
      owner?: { login?: string };
      name?: string;
    };
    return {
      full_name: record.full_name ?? `${record.owner?.login ?? ""}/${record.name ?? ""}`,
      default_branch: record.default_branch ?? "main",
      fork: record.fork ?? false,
      owner: { login: record.owner?.login ?? "" },
    };
  };

  return {
    authenticated: (): boolean => cachedToken !== null,
    getRepo: (owner: string, repo: string) =>
      request(`get ${owner}/${repo}`, `/repos/${owner}/${repo}`).pipe(
        Effect.map(({ body }) => repoFrom(body)),
        Effect.catch((error) => (error.status === 404 ? Effect.succeed(null) : Effect.fail(error))),
      ),
    getBranch: (owner: string, repo: string, branch: string) =>
      request(`get branch ${branch}`, `/repos/${owner}/${repo}/branches/${branch}`).pipe(
        Effect.map(({ body }) => {
          const record = body as { commit?: { sha?: string } };
          const sha = record.commit?.sha;
          return sha ? { sha } : null;
        }),
        Effect.catch((error) => (error.status === 404 ? Effect.succeed(null) : Effect.fail(error))),
      ),
    createFork: (owner: string, repo: string) =>
      request(`fork ${owner}/${repo}`, `/repos/${owner}/${repo}/forks`, { method: "POST" }).pipe(
        Effect.map(({ body }) => repoFrom(body)),
        Effect.catch((error) =>
          error.status === 409
            ? request(`get ${owner}/${repo}`, `/repos/${owner}/${repo}`).pipe(
                Effect.map(({ body }) => repoFrom(body)),
              )
            : Effect.fail(error),
        ),
      ),
    createBranch: (owner: string, repo: string, branch: string, sha: string) =>
      request(`create branch ${branch}`, `/repos/${owner}/${repo}/git/refs`, {
        method: "POST",
        body: JSON.stringify({ ref: `refs/heads/${branch}`, sha }),
      }).pipe(
        Effect.asVoid,
        Effect.catch((error) =>
          // Reference already exists: the contribution branch is reusable.
          error.status === 422 ? Effect.void : Effect.fail(error),
        ),
      ),
    putFile: ({ owner, repo, branch, path, content, message }: { owner: string; repo: string; branch: string; path: string; content: string; message: string }): Effect.Effect<void, GitHubError> => {
      const attempt = (sha: string | null): Effect.Effect<void, GitHubError> =>
        request(`commit ${path}`, `/repos/${owner}/${repo}/contents/${path}`, {
          method: "PUT",
          body: JSON.stringify({
            message,
            content: Buffer.from(content, "utf8").toString("base64"),
            branch,
            ...(sha ? { sha } : {}),
          }),
        }).pipe(Effect.asVoid);
      return attempt(null).pipe(
        Effect.catch((error) =>
          error.status === 422
            ? request(`sha ${path}`, `/repos/${owner}/${repo}/contents/${path}?ref=${branch}`).pipe(
                Effect.flatMap(({ body }) => {
                  const sha = (body as { sha?: string }).sha;
                  return sha ? attempt(sha) : Effect.fail(error);
                }),
              )
            : Effect.fail(error),
        ),
      );
    },
    createPull: (input: { owner: string; repo: string; title: string; head: string; base: string; body: string }) =>
      request("create pull request", `/repos/${input.owner}/${input.repo}/pulls`, {
        method: "POST",
        body: JSON.stringify({ title: input.title, head: input.head, base: input.base, body: input.body }),
      }).pipe(
        Effect.map(({ body: pull }) => {
          const record = pull as { number?: number; html_url?: string };
          return {
            number: record.number ?? 0,
            html_url: record.html_url ?? `https://github.com/${input.owner}/${input.repo}/pulls`,
          } satisfies GitHubPullRequest;
        }),
      ),
  };
};
