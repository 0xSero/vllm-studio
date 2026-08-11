"use client";

import { useCallback, useState } from "react";
import { Effect, Schema } from "effect";
import { Button } from "@/ui";
import { ResourceDrawer, ResourceDrawerSection, ResourceFact } from "@/ui/resource-drawer";
import { ResourceList } from "@/features/resources/resource-list";
import { ResourceLogo } from "@/ui/resource-logo";
import { ModelRow, ModelStatus, ModelValue } from "@/features/recipes/recipes-content/model-page";
import { useAsyncResource } from "@/hooks/use-async-resource";
import { writeClipboardText } from "@/lib/clipboard";
import { requestJsonEffect } from "@/lib/api/request-json";

const SkillSchema = Schema.Struct({
  id: Schema.String,
  name: Schema.String,
  source: Schema.String,
  path: Schema.String,
  instructions: Schema.optional(Schema.String),
});

const SkillsResponseSchema = Schema.Struct({
  skills: Schema.Array(SkillSchema),
});

const SkillResponseSchema = Schema.Struct({
  skill: SkillSchema,
});

type Skill = Schema.Schema.Type<typeof SkillSchema>;

function SkillDrawer({
  skill,
  loaded,
  loading,
  error,
  onClose,
}: {
  skill: Skill;
  loaded: Skill | null;
  loading: boolean;
  error: string;
  onClose: () => void;
}) {
  const [copied, setCopied] = useState(false);
  return (
    <ResourceDrawer
      title={skill.name}
      icon={<ResourceLogo identity={skill.source} label={skill.name} />}
      badge={
        <ModelStatus tone={error ? "danger" : loading ? "info" : "good"}>SKILL.md</ModelStatus>
      }
      status={`${skill.source} · ${skill.path}`}
      footer={
        <>
          <Button
            variant="secondary"
            onClick={() => {
              void writeClipboardText(skill.path)
                .then(() => setCopied(true))
                .catch(() => setCopied(false));
            }}
          >
            {copied ? "Copied" : "Copy path"}
          </Button>
          <Button onClick={onClose}>Done</Button>
        </>
      }
      onClose={onClose}
    >
      <section className="mb-6">
        <div className="mb-2">
          <h3 className="text-[length:var(--fs-base)] font-medium text-(--ui-fg)">Instructions</h3>
          <p className="mt-0.5 text-[length:var(--fs-sm)] text-(--ui-muted)">
            The instruction file loaded when this skill is selected in Workbench.
          </p>
        </div>
        <div className="max-h-[52dvh] overflow-auto rounded-md border border-(--ui-separator) bg-(--color-input) p-3">
          <pre className="whitespace-pre-wrap break-words font-mono text-[length:var(--fs-sm)] leading-5 text-(--ui-fg)/90">
            {loading
              ? "Loading SKILL.md…"
              : error || loaded?.instructions || "No instructions found."}
          </pre>
        </div>
      </section>
      <ResourceDrawerSection title="Identity">
        <ResourceFact label="Source" value={skill.source} />
        <ResourceFact label="Skill ID" value={skill.id} mono />
        <ResourceFact label="Directory" value={skill.path} mono />
      </ResourceDrawerSection>
    </ResourceDrawer>
  );
}

export function SkillsSection() {
  const [selected, setSelected] = useState<Skill | null>(null);
  const [selectedSkill, setSelectedSkill] = useState<Skill | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState("");

  const loadSkills = useCallback(
    () =>
      Effect.runPromise(
        requestJsonEffect(
          "/api/agent/skills",
          SkillsResponseSchema,
          { cache: "no-store" },
          "Skill discovery failed",
        ),
      ).then((payload) => payload.skills),
    [],
  );
  const {
    data: skills,
    loaded,
    error,
  } = useAsyncResource(loadSkills, [] as readonly Skill[], "Skill discovery failed", {
    clearOnError: true,
  });

  const openSkill = (skill: Skill) => {
    setSelected(skill);
    setSelectedSkill(null);
    setDetailLoading(true);
    setDetailError("");
    void Effect.runPromise(
      requestJsonEffect(
        `/api/agent/skills/load?path=${encodeURIComponent(skill.path)}`,
        SkillResponseSchema,
        undefined,
        "Skill loading failed",
      ),
    )
      .then((payload) => setSelectedSkill(payload.skill))
      .catch((loadError: unknown) =>
        setDetailError(loadError instanceof Error ? loadError.message : "Skill loading failed"),
      )
      .finally(() => setDetailLoading(false));
  };

  return (
    <>
      <ResourceList
        title="Skills"
        description="Reusable instruction sets discovered across Local Studio, Codex, Claude, Pi, Factory, and OpenCode."
        items={skills}
        loaded={loaded}
        searchLabel="Search skills"
        searchDescription="Name, source, company, or path."
        searchPlaceholder="Search skills"
        searchableText={(skill) => `${skill.name} ${skill.source} ${skill.path}`}
        summaryTone={() => (error ? "warning" : loaded ? "good" : "default")}
        empty={(query, total) =>
          total ? `No skills match “${query}”.` : "No SKILL.md entries were found."
        }
        renderItem={(skill) => (
          <ModelRow
            key={skill.id}
            label={skill.name}
            description={`Available in Workbench · ${skill.source}`}
            leading={<ResourceLogo identity={skill.source} label={skill.name} />}
            value={<ModelValue mono>{skill.path}</ModelValue>}
            status={<ModelStatus tone="info">discovered</ModelStatus>}
            onClick={() => openSkill(skill)}
          />
        )}
      />
      {selected ? (
        <SkillDrawer
          skill={selected}
          loaded={selectedSkill}
          loading={detailLoading}
          error={detailError}
          onClose={() => {
            setSelected(null);
            setSelectedSkill(null);
            setDetailError("");
          }}
        />
      ) : null}
    </>
  );
}
