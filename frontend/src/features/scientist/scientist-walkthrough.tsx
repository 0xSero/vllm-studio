"use client";

import { useCallback, useState } from "react";
import { useRouter } from "next/navigation";
import { Alert, Button, Card, Spinner } from "@/ui";
import api from "@/lib/api/client";
import type { ScientistProfile } from "@local-studio/contracts/scientist-profile";
import { ProjectTemplatePicker } from "./project-template-picker";
import { useMountSubscription } from "@/hooks/use-mount-subscription";

const WALKTHROUGH_STEPS = [
  {
    id: "create-project",
    title: "Create your first project",
    description:
      "Pick a template that matches your work. We'll create a notebook with starter code and set up the AI assistant.",
  },
  {
    id: "open-notebook",
    title: "Open the notebook",
    description:
      "Your project comes with a notebook file. Open it to see the starter cells — markdown explanations and Python code.",
  },
  {
    id: "run-cell",
    title: "Run a cell",
    description:
      "Click the play button next to a code cell to run it. The AI can also run cells for you — just ask in the chat.",
  },
  {
    id: "chat",
    title: "Ask the AI for help",
    description:
      "Use the chat panel to ask questions about your data, request code, or get explanations. The AI knows about your project.",
  },
] as const;

export function ScientistWalkthrough() {
  const router = useRouter();
  const [profile, setProfile] = useState<ScientistProfile | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [currentStep, setCurrentStep] = useState(0);
  const [showTemplatePicker, setShowTemplatePicker] = useState(false);

  useMountSubscription(() => {
    let cancelled = false;
    api
      .getScientistProfile()
      .then(({ profile: fetched }) => {
        if (!cancelled) {
          setProfile(fetched);
          setLoading(false);
        }
      })
      .catch((err) => {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : "Could not load profile");
          setLoading(false);
        }
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const handleProjectCreated = useCallback(() => {
    setCurrentStep(1);
    setShowTemplatePicker(false);
  }, []);

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Spinner />
      </div>
    );
  }

  if (error) {
    return (
      <Alert variant="error">
        {error}
        <Button variant="ghost" className="ml-2" onClick={() => router.push("/scientist")}>
          Edit profile
        </Button>
      </Alert>
    );
  }

  return (
    <div className="mx-auto max-w-3xl px-4 py-8">
      <div className="mb-8">
        <h1 className="text-2xl font-semibold">
          Welcome{profile?.specialization ? `, ${profile.specialization}` : ""}!
        </h1>
        <p className="mt-2 text-muted-foreground">
          Let&apos;s get you started with your first project. Follow these steps to get up and
          running.
        </p>
      </div>

      <div className="mb-8 space-y-3">
        {WALKTHROUGH_STEPS.map((step, i) => (
          <Card
            key={step.id}
            className={`p-4 transition-opacity ${i > currentStep ? "opacity-50" : ""}`}
          >
            <div className="flex items-start gap-3">
              <div
                className={`flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full text-sm font-medium ${
                  i < currentStep
                    ? "bg-primary text-primary-foreground"
                    : i === currentStep
                      ? "border-2 border-primary text-primary"
                      : "border border-border text-muted-foreground"
                }`}
              >
                {i < currentStep ? "✓" : i + 1}
              </div>
              <div className="flex-1">
                <h3 className="font-medium">{step.title}</h3>
                <p className="text-sm text-muted-foreground">{step.description}</p>
                {i === currentStep && i === 0 && !showTemplatePicker && (
                  <Button className="mt-3" size="sm" onClick={() => setShowTemplatePicker(true)}>
                    Create a project
                  </Button>
                )}
                {i === currentStep && i === 1 && (
                  <Button
                    className="mt-3"
                    size="sm"
                    variant="secondary"
                    onClick={() => router.push("/agent")}
                  >
                    Go to workspace
                  </Button>
                )}
                {i === currentStep && i === 2 && (
                  <Button
                    className="mt-3"
                    size="sm"
                    variant="secondary"
                    onClick={() => router.push("/science")}
                  >
                    Open scientific workbench
                  </Button>
                )}
                {i === currentStep && i === 3 && (
                  <Button
                    className="mt-3"
                    size="sm"
                    variant="secondary"
                    onClick={() => router.push("/agent")}
                  >
                    Start chatting
                  </Button>
                )}
              </div>
            </div>
          </Card>
        ))}
      </div>

      {showTemplatePicker && (
        <Card className="p-6">
          <ProjectTemplatePicker onProjectCreated={handleProjectCreated} />
        </Card>
      )}

      <div className="mt-8 flex justify-between">
        <Button variant="ghost" onClick={() => router.push("/scientist")}>
          Edit my profile
        </Button>
        <Button variant="secondary" onClick={() => router.push("/agent")}>
          Skip to workspace
        </Button>
      </div>
    </div>
  );
}
