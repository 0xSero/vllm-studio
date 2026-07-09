"use client";

import { Check } from "@/ui/icon-registry";
import { Card } from "@/ui";
import { setupSteps } from "./utils";

export function SetupStepper({ step }: { step: number }) {
  const current = setupSteps[step] ?? setupSteps[0];

  return (
    <Card padding="md" className="lg:sticky lg:top-6">
      <div className="mb-4 border-b border-(--ui-border) pb-4">
        <div className="font-mono text-[length:var(--fs-2xs)] uppercase tracking-[0.18em] text-(--ui-muted)">
          Step {step + 1} of {setupSteps.length}
        </div>
        <div className="mt-1 text-[length:var(--fs-lg)] font-medium text-(--ui-fg)">
          {current.label}
        </div>
        <p className="mt-1 text-[length:var(--fs-xs)] leading-5 text-(--ui-muted)">
          {current.description}
        </p>
      </div>
      <ol className="grid grid-cols-3 gap-2 sm:grid-cols-6 lg:grid-cols-1">
        {setupSteps.map((item, index) => {
          const complete = index < step;
          const active = index === step;
          return (
            <li
              key={item.label}
              aria-current={active ? "step" : undefined}
              className={`flex min-w-0 items-center gap-2 rounded-md px-2 py-2 ${
                active ? "bg-(--ui-accent)/10 text-(--ui-fg)" : "text-(--ui-muted)"
              }`}
            >
              <span
                className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full border font-mono text-[length:var(--fs-2xs)] ${
                  complete
                    ? "border-(--ui-success)/60 text-(--ui-success)"
                    : active
                      ? "border-(--ui-accent) text-(--ui-accent)"
                      : "border-(--ui-border)"
                }`}
              >
                {complete ? <Check className="h-3.5 w-3.5" /> : index + 1}
              </span>
              <span className="truncate text-[length:var(--fs-sm)] font-medium">{item.label}</span>
            </li>
          );
        })}
      </ol>
    </Card>
  );
}
