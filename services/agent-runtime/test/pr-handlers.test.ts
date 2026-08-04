import { describe, expect, test } from "bun:test";
import { normalizeChecks, normalizePrView } from "../src/http/pr-handlers";

describe("normalizeChecks", () => {
  test("buckets Actions check runs by status/conclusion", () => {
    const { checks, summary } = normalizeChecks([
      { __typename: "CheckRun", name: "build", status: "COMPLETED", conclusion: "SUCCESS" },
      { __typename: "CheckRun", name: "lint", status: "COMPLETED", conclusion: "FAILURE" },
      { __typename: "CheckRun", name: "e2e", status: "IN_PROGRESS", conclusion: null },
      { __typename: "CheckRun", name: "skipped", status: "COMPLETED", conclusion: "SKIPPED" },
    ]);
    expect(summary).toEqual({ passing: 2, failing: 1, pending: 1, total: 4 });
    expect(checks[0]).toEqual({
      name: "build",
      status: "COMPLETED",
      conclusion: "SUCCESS",
      bucket: "passing",
    });
    expect(checks[2].bucket).toBe("pending");
  });

  test("buckets legacy commit status contexts by state", () => {
    const { summary } = normalizeChecks([
      { __typename: "StatusContext", context: "ci/circleci", state: "SUCCESS" },
      { __typename: "StatusContext", context: "ci/deploy", state: "PENDING" },
      { __typename: "StatusContext", context: "ci/error", state: "ERROR" },
      { __typename: "StatusContext", context: "ci/fail", state: "FAILURE" },
    ]);
    expect(summary).toEqual({ passing: 1, pending: 1, failing: 2, total: 4 });
  });

  test("treats completed runs without a conclusion as pending", () => {
    const { summary } = normalizeChecks([
      { name: "queued", status: "QUEUED", conclusion: null },
      { name: "orphan", status: "COMPLETED", conclusion: null },
    ]);
    expect(summary.pending).toBe(2);
    expect(summary.total).toBe(2);
  });

  test("handles non-array rollup (null) as empty", () => {
    expect(normalizeChecks(null)).toEqual({
      checks: [],
      summary: { pending: 0, passing: 0, failing: 0, total: 0 },
    });
    expect(normalizeChecks(undefined).summary.total).toBe(0);
  });

  test("falls back to a name for unlabeled entries", () => {
    const { checks } = normalizeChecks([{ status: "COMPLETED", conclusion: "SUCCESS" }]);
    expect(checks[0].name).toBe("check");
  });
});

describe("normalizePrView", () => {
  test("maps reviewers, comment count, and check summary", () => {
    const pr = normalizePrView({
      number: 42,
      title: "Add PR tab",
      url: "https://github.com/o/r/pull/42",
      state: "OPEN",
      isDraft: false,
      headRefName: "overnight/wave-fixes",
      baseRefName: "main",
      additions: 120,
      deletions: 8,
      reviewRequests: [{ login: "octocat" }, { name: "Platform", slug: "platform" }],
      reviews: [{ author: { login: "octocat" }, state: "APPROVED" }],
      comments: [{ body: "a" }, { body: "b" }],
      body: "## Description\nDetails",
      mergeable: "MERGEABLE",
      statusCheckRollup: [
        { name: "build", status: "COMPLETED", conclusion: "SUCCESS" },
      ],
    });
    expect(pr.number).toBe(42);
    expect(pr.reviewers).toEqual(["octocat", "Platform"]);
    expect(pr.commentsCount).toBe(2);
    expect(pr.checksSummary).toEqual({ passing: 1, failing: 0, pending: 0, total: 1 });
    expect(pr.mergeable).toBe("MERGEABLE");
  });

  test("defensively fills missing fields", () => {
    const pr = normalizePrView({});
    expect(pr.number).toBe(0);
    expect(pr.title).toBe("");
    expect(pr.reviewers).toEqual([]);
    expect(pr.commentsCount).toBe(0);
    expect(pr.checks).toEqual([]);
    expect(pr.state).toBe("UNKNOWN");
  });
});
