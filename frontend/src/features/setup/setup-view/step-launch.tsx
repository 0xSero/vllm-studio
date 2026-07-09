"use client";

import { Rocket } from "@/ui/icon-registry";
import { Alert, Button, Card, Spinner } from "@/ui";
import { FactGrid } from "@/features/setup/fact-grid";
import { defaultRuntimeForBackend } from "@/lib/serve-runtime";
import type { Backend } from "@/lib/types";

export function StepLaunch({
  backend,
  selectedModel,
  createdRecipeId,
  configuringRecipe,
  launchError,
  configureAndLaunch,
}: {
  backend: Backend;
  selectedModel: string;
  createdRecipeId: string | null;
  configuringRecipe: boolean;
  launchError: string | null;
  configureAndLaunch: () => void;
}) {
  const runtime = defaultRuntimeForBackend(backend);

  return (
    <div className="space-y-6">
      <Card padding="lg" className="space-y-4">
        <div className="flex items-center gap-3">
          <Rocket className="h-5 w-5 text-(--hl1)" />
          <h2 className="text-lg font-medium">Create your first Serve</h2>
        </div>
        <p className="text-sm text-(--dim)">
          Local Studio will bind <span className="text-(--fg)">{selectedModel}</span> to its
          runtime, save the launch configuration, and bring the API online. If the managed runtime
          is missing, this step installs it first.
        </p>
        <FactGrid
          variant="panel"
          items={[
            { label: "Engine", value: backend },
            { label: "Runtime", value: runtime.label ?? runtime.ref },
            { label: "dtype", value: "auto" },
            {
              label: "Next",
              value:
                "Advanced context, parser, memory, and performance settings remain editable on the saved Serve.",
              span: "full",
            },
          ]}
        />
        {createdRecipeId && (
          <div className="text-xs text-(--dim)">
            Saved Serve id: <span className="text-(--fg)">{createdRecipeId}</span>
          </div>
        )}
        {launchError && <Alert variant="error">{launchError}</Alert>}
        <Button
          onClick={configureAndLaunch}
          disabled={configuringRecipe}
          icon={configuringRecipe ? <Spinner /> : <Rocket className="h-4 w-4" />}
        >
          {configuringRecipe ? "Preparing Serve…" : "Create & Launch Serve"}
        </Button>
      </Card>
    </div>
  );
}
