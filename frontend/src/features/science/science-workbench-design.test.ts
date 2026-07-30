import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, test } from "node:test";

const source = (name: string) => readFileSync(new URL(name, import.meta.url), "utf8");

describe("scientific workbench design contract", () => {
  const page = source("scientific-workbench-page.tsx");
  const panel = source("agent-notebook-showcase.tsx");
  const components = source("science-workbench-components.tsx");
  const support = source("notebook-panel-support.tsx");
  const admission = source("ray-admission-form.tsx");
  const api = source("../../lib/api/workbench.ts");
  const tokens = source("../../app/styles/globals/tokens.css");

  test("renders semantic workbench landmarks and handling authority", () => {
    assert.match(page, /<main/);
    assert.match(page, /<header/);
    assert.match(components, /aria-label="Evidence margin"/);
    assert.match(components, /<footer/);
    assert.match(page, /href="#main-content"/);
    assert.match(page, /id="main-content"/);
    assert.match(components, /mode changes deployment, not governance semantics/);
    assert.match(components, /data-handling-origin="derived"/);
  });

  test("uses the closed DS-3 claim-state vocabulary", () => {
    for (const state of [
      "observed",
      "inferred",
      "claimed",
      "attested",
      "contradicted",
      "quarantined",
    ]) {
      assert.match(components, new RegExp(state));
    }
    assert.match(components, /◆/);
    assert.match(components, /⊭/);
    assert.match(components, /⊘/);
    assert.match(components, /data-proof=\{receiptDigest\}/);
  });

  test("binds notebook actions to controller sessions and approvals", () => {
    assert.match(panel, /requestNotebookApproval/);
    assert.match(panel, /Approval request failed/);
    assert.match(panel, /currentSession\.id/);
    assert.match(panel, /approval_id: approval\.id/);
    assert.match(panel, /Discard unsaved notebook cell changes\?/);
    assert.match(panel, /event\.key !== "Escape"/);
    assert.match(panel, /role="dialog"/);
    assert.match(panel, /min-h-11/);
  });

  test("offers Python SmolVM through the editable approved notebook workflow", () => {
    assert.match(page, /value: "python-smolvm"/);
    assert.match(page, /Python · SmolVM/);
    assert.match(support, /notebook\?\.runtime === "python"/);
    assert.match(panel, /<Textarea/);
    assert.match(panel, /patchNotebookCell/);
    assert.match(panel, /executeNotebookCell/);
    assert.match(panel, /requestNotebookApproval/);
  });

  test("uses governed AI primitives for observable activity without hidden reasoning", () => {
    assert.match(support, /AgentCard/);
    assert.match(support, /Observable notebook controller activity/);
    assert.match(support, /Controller-issued, revision-bound approval/);
    assert.doesNotMatch(support, /ReasoningSummary|ChainOfThought|Thought/);
    assert.doesNotMatch(panel, /ReasoningSummary|ChainOfThought|Thought/);
  });

  test("reserves emergency hue for containment rather than ordinary controller failures", () => {
    assert.doesNotMatch(page, /role="alert" className="[^"]*--ui-danger/);
    assert.doesNotMatch(support, /role="alert" className="[^"]*--ui-danger/);
  });

  test("keeps the expandable notebook usable across loading, narrow and keyboard states", () => {
    assert.match(panel, /No notebook loaded/);
    assert.match(panel, /Loading notebook/);
    assert.match(panel, /Create or select a controller notebook session/);
    assert.match(panel, /Control or Command \+ Enter runs this cell/);
    assert.match(panel, /event\.ctrlKey \|\| event\.metaKey/);
    assert.match(panel, /aria-describedby/);
    assert.match(panel, /spellCheck=\{false\}/);
    assert.match(panel, /inset-x-3/);
    assert.match(panel, /sm:left-auto/);
    assert.match(panel, /useCallback/);
    assert.match(panel, /element\?\.focus\(\)/);
    assert.doesNotMatch(panel, /requestAnimationFrame/);
    assert.match(support, /Node\.js · SmolVM/);
    assert.match(panel, /sessions\.find\(\(\{ document_path \}\) => document_path\)/);
    assert.match(panel, /void inspectPath\(path\)/);
  });

  test("keeps evidence semantics separate from generic colored status pills", () => {
    assert.doesNotMatch(page, /StatusPill/);
    assert.doesNotMatch(panel, /StatusPill/);
    assert.doesNotMatch(components, /StatusPill/);
    assert.doesNotMatch(support, /StatusPill/);
    assert.match(components, /className=\{`flex min-h-11 min-w-0/);
    assert.doesNotMatch(components, /inline-flex min-h-11/);
    assert.match(components, /\[overflow-wrap:anywhere\]/);
  });

  test("exposes authoritative Ray lifecycle and admission controls", () => {
    assert.match(components, /Submit/);
    assert.match(components, /Reconcile/);
    assert.match(components, /Create receipt/);
    assert.match(admission, /issueScientificComputeLease/);
    assert.match(admission, /issueScientificDatasetAttachment/);
    assert.match(admission, /compute_lease_id: lease\.id/);
    assert.match(admission, /datasets\.push\(attachment\)/);
    assert.match(api, /\/workbench\/compute-leases/);
    assert.match(api, /\/workbench\/dataset-attachments/);
  });

  test("resolves the four required cortAIx modes", () => {
    assert.match(tokens, /data-theme="cortaix-light"/);
    assert.match(tokens, /data-theme="cortaix-dark"/);
    assert.match(tokens, /data-contrast-mode="high"/);
    assert.match(tokens, /@media \(forced-colors: active\)/);
  });
});
