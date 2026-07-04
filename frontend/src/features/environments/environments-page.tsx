"use client";

import {
  Alert,
  AppPage,
  Button,
  Card,
  Input,
  PageContainer,
  PageHeader,
  PageState,
  RefreshButton,
  Select,
  StatusPill,
  Table,
  TBody,
  TCell,
  TH,
  THead,
  TRow,
} from "@/ui";
import { useEnvironments } from "@/features/environments/use-environments";
import type { EnvironmentWithStatus } from "@/lib/types";

function EnvironmentStatus({ environment }: { environment: EnvironmentWithStatus }) {
  return (
    <div className="flex items-center gap-2">
      <StatusPill tone={environment.running ? "good" : "default"}>
        {environment.running ? "running" : "stopped"}
      </StatusPill>
      {!environment.imagePulled && !environment.running ? (
        <StatusPill tone="warning" variant="badge">
          image not pulled
        </StatusPill>
      ) : null}
    </div>
  );
}

export default function EnvironmentsPage() {
  const {
    environments,
    recipes,
    loading,
    error,
    form,
    setForm,
    creating,
    pendingActionId,
    engineOptions,
    loadAll,
    handleCreate,
    handleDelete,
    handleStart,
    handleStop,
    handlePullImage,
  } = useEnvironments();

  const pageStateRender = PageState({
    loading,
    data: environments,
    hasData: environments.length > 0,
    error,
    onLoad: loadAll,
  });
  if (pageStateRender) return <AppPage>{pageStateRender}</AppPage>;

  return (
    <AppPage>
      <PageContainer width="sm">
        <PageHeader
          title="Environments"
          description="Every docker-capable recipe is seeded here as a container pinned to an official vLLM, SGLang, or llama.cpp image. Adjust the version, then start it."
          actions={<RefreshButton onRefresh={loadAll} loading={loading} />}
        />

        {error ? (
          <Alert variant="error" className="mb-5">
            {error}
          </Alert>
        ) : null}

        <Card
          title="Additional environment"
          description="Pair an existing recipe with a different engine or image version."
        >
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-5">
            <Input
              label="Name"
              value={form.name}
              onChange={(event) => setForm({ ...form, name: event.target.value })}
              placeholder="Qwen3-32B (vLLM v0.24.0)"
            />
            <Select
              label="Recipe"
              value={form.recipeId}
              onChange={(event) => setForm({ ...form, recipeId: event.target.value })}
              placeholder="Choose a recipe"
              options={recipes.map((recipe) => ({ value: recipe.id, label: recipe.name }))}
            />
            <Select
              label="Engine"
              value={form.engineId}
              onChange={(event) =>
                setForm({ ...form, engineId: event.target.value as typeof form.engineId })
              }
              options={engineOptions}
            />
            <Input
              label="Version"
              value={form.version}
              onChange={(event) => setForm({ ...form, version: event.target.value })}
              placeholder="0.24.0"
            />
            <Input
              label="Variant (optional)"
              value={form.variant}
              onChange={(event) => setForm({ ...form, variant: event.target.value })}
              placeholder="cu129"
            />
          </div>
          <Button
            className="mt-3"
            onClick={() => void handleCreate()}
            disabled={creating || !form.name.trim() || !form.recipeId || !form.version.trim()}
          >
            {creating ? "Creating…" : "Create environment"}
          </Button>
        </Card>

        <section className="mt-5">
          <Table>
            <THead>
              <TRow>
                <TH>Name</TH>
                <TH>Engine</TH>
                <TH>Image</TH>
                <TH>Status</TH>
                <TH align="right">Actions</TH>
              </TRow>
            </THead>
            <TBody>
              {environments.length === 0 ? (
                <TRow>
                  <TCell colSpan={5} className="py-6 text-center text-(--ui-muted)">
                    No environments yet — add a vLLM, SGLang, or llama.cpp recipe and they are
                    seeded automatically.
                  </TCell>
                </TRow>
              ) : (
                environments.map((environment) => {
                  const busy = pendingActionId === environment.id;
                  return (
                    <TRow key={environment.id}>
                      <TCell>{environment.name}</TCell>
                      <TCell className="font-mono text-[length:var(--fs-sm)]">
                        {environment.engineId} {environment.version}
                        {environment.variant ? `-${environment.variant}` : ""}
                      </TCell>
                      <TCell className="font-mono text-[length:var(--fs-xs)] text-(--ui-muted)">
                        {environment.image}
                      </TCell>
                      <TCell>
                        <EnvironmentStatus environment={environment} />
                      </TCell>
                      <TCell align="right">
                        <div className="flex justify-end gap-2">
                          {!environment.imagePulled && !environment.running ? (
                            <Button
                              variant="secondary"
                              disabled={busy}
                              onClick={() =>
                                void handlePullImage(environment.id, environment.image)
                              }
                            >
                              {busy ? "Pulling…" : "Pull image"}
                            </Button>
                          ) : null}
                          {environment.running ? (
                            <Button
                              variant="secondary"
                              disabled={busy}
                              onClick={() => void handleStop(environment.id)}
                            >
                              Stop
                            </Button>
                          ) : (
                            <Button
                              variant="secondary"
                              disabled={busy}
                              onClick={() => void handleStart(environment.id)}
                            >
                              Start
                            </Button>
                          )}
                          <Button
                            variant="secondary"
                            disabled={busy}
                            onClick={() => void handleDelete(environment.id)}
                          >
                            Delete
                          </Button>
                        </div>
                      </TCell>
                    </TRow>
                  );
                })
              )}
            </TBody>
          </Table>
        </section>
      </PageContainer>
    </AppPage>
  );
}
