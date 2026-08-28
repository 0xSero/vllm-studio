"use client";

import { useState } from "react";
import { ExternalLink } from "@/ui/icon-registry";
import { Button, StatusPill } from "@/ui";
import { UiModal, UiModalBody, UiModalFooter, UiModalHeader } from "@/ui/modal";
import api from "@/lib/api/client";
import type { SharePreviewPayload } from "@/lib/api/registry";
import type { RecipeWithStatus } from "@/lib/types";
import { useMountSubscription } from "@/hooks/use-mount-subscription";

const FALLBACK_NOTICE = "This will create a PR to https://github.com/0xSero/local-ai-registry";

type Step = "loading" | "ask" | "confirm" | "creating" | "done" | "error";

/**
 * The Share config flow, in the registry's own words:
 *   1. Share config -> Share / Decline.
 *   2. Share -> the exact PR notice -> Create PR / Decline.
 *   3. Create PR -> fork + branch + commit + pull request.
 * Nothing touches GitHub until the second confirmation.
 */
export function ShareConfigModal({
  recipe,
  onClose,
}: {
  recipe: RecipeWithStatus;
  onClose: () => void;
}) {
  const [step, setStep] = useState<Step>("loading");
  const [preview, setPreview] = useState<SharePreviewPayload | null>(null);
  const [notice, setNotice] = useState(FALLBACK_NOTICE);
  const [error, setError] = useState<string | null>(null);
  const [pullRequestUrl, setPullRequestUrl] = useState<string | null>(null);

  useMountSubscription(() => {
    let cancelled = false;
    api
      .getSharePreview(recipe.id)
      .then((payload) => {
        if (cancelled) return;
        setPreview(payload);
        setStep("ask");
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : "Could not build the contribution");
        setStep("error");
      });
    api
      .getShareNotice()
      .then((payload) => {
        if (!cancelled && payload.notice) setNotice(payload.notice);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [recipe.id]);

  const createPullRequest = () => {
    setStep("creating");
    api
      .createSharePullRequest(recipe.id, true)
      .then((result) => {
        setPullRequestUrl(result.pull_request_url);
        setStep("done");
      })
      .catch((err: unknown) => {
        setError(err instanceof Error ? err.message : "The pull request could not be created");
        setStep("error");
      });
  };

  return (
    <UiModal isOpen onClose={onClose} maxWidth="max-w-lg">
      <UiModalHeader title={`Share config — ${recipe.name}`} onClose={onClose} />
      <UiModalBody>
        <ShareStepBody
          step={step}
          preview={preview}
          notice={notice}
          error={error}
          pullRequestUrl={pullRequestUrl}
        />
      </UiModalBody>
      <UiModalFooter>
        {step === "ask" ? (
          <>
            <Button variant="ghost" onClick={onClose}>
              Decline
            </Button>
            <Button
              variant="primary"
              disabled={!preview?.shareable}
              onClick={() => setStep("confirm")}
            >
              Share
            </Button>
          </>
        ) : null}
        {step === "confirm" ? (
          <>
            <Button variant="ghost" onClick={onClose}>
              Decline
            </Button>
            <Button variant="primary" loading={false} onClick={createPullRequest}>
              Create PR
            </Button>
          </>
        ) : null}
        {step === "loading" || step === "creating" ? (
          <Button variant="ghost" onClick={onClose} disabled={step === "creating"}>
            Decline
          </Button>
        ) : null}
        {step === "done" || step === "error" ? (
          <Button variant="primary" onClick={onClose}>
            Close
          </Button>
        ) : null}
      </UiModalFooter>
    </UiModal>
  );
}

function ShareStepBody({
  step,
  preview,
  notice,
  error,
  pullRequestUrl,
}: {
  step: Step;
  preview: SharePreviewPayload | null;
  notice: string;
  error: string | null;
  pullRequestUrl: string | null;
}) {
  if (step === "ask" && preview) return <AskBody preview={preview} />;
  if (step === "confirm") {
    return (
      <div className="space-y-3">
        <p className="text-[length:var(--fs-base)] font-medium text-(--fg)">{notice}</p>
        <p className="text-[length:var(--fs-sm)] text-(--ui-muted)">
          A contribution branch on your fork with {preview?.file_paths.length ?? 0} record file
          {preview?.file_paths.length === 1 ? "" : "s"} is committed, then the pull request is
          opened. Decline cancels everything.
        </p>
      </div>
    );
  }
  if (step === "done") {
    return (
      <div className="space-y-3">
        <div className="flex items-center gap-2">
          <StatusPill tone="good">opened</StatusPill>
          <span className="text-[length:var(--fs-base)] text-(--fg)">
            Pull request opened against the registry.
          </span>
        </div>
        {pullRequestUrl ? (
          <a
            href={pullRequestUrl}
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-1.5 text-[length:var(--fs-sm)] text-(--ui-muted) transition-colors hover:text-(--fg)"
          >
            {pullRequestUrl}
            <ExternalLink className="h-3 w-3" />
          </a>
        ) : null}
      </div>
    );
  }
  const quiet =
    step === "loading"
      ? "Building the registry contribution from this configuration…"
      : step === "creating"
        ? "Creating the fork, branch, and pull request…"
        : null;
  if (quiet !== null) {
    return <p className="text-[length:var(--fs-base)] leading-relaxed text-(--ui-muted)">{quiet}</p>;
  }
  return <p className="text-[length:var(--fs-base)] leading-relaxed text-(--err)">{error}</p>;
}

function AskBody({ preview }: { preview: SharePreviewPayload }) {
  return (
    <div className="space-y-3 text-[length:var(--fs-base)] leading-relaxed text-(--ui-muted)">
      <p>
        This publishes the working configuration as registry records — hardware, model artifact,
        engine, launch arguments, and any measured speed evidence — for other local operators to
        reuse.
      </p>
      <ul className="space-y-1 font-mono text-[length:var(--fs-sm)]">
        <li>
          hardware:{" "}
          {preview.hardware ? `${preview.hardware.name} ×${preview.hardware.count}` : "—"}
        </li>
        <li>records: {preview.file_paths.join(", ")}</li>
        <li>
          validation:{" "}
          {preview.validation.ok ? (
            <span className="text-(--ok)">schema ok</span>
          ) : (
            <span className="text-(--err)">{preview.validation.issues.length} issues</span>
          )}
        </li>
        {preview.redactions.length > 0 ? (
          <li>redacted: {preview.redactions.join(", ")}</li>
        ) : (
          <li>redacted: nothing sensitive found</li>
        )}
      </ul>
      {!preview.shareable && preview.reason ? (
        <p className="rounded-lg border border-(--warn)/40 bg-(--warn)/10 p-2.5 text-[length:var(--fs-sm)] text-(--fg)">
          {preview.reason}
        </p>
      ) : null}
    </div>
  );
}
