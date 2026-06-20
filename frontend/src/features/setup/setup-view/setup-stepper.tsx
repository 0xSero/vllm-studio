"use client";

import { ChevronRight } from "@/ui/icon-registry";
import { setupSteps } from "./utils";

export function SetupStepper({ step }: { step: number }) {
  return (
    <div className="mb-8 max-w-full overflow-x-auto pb-1">
      <div className="flex min-w-max items-center gap-3 pr-2">
        {setupSteps.map((label, index) => (
          <div key={label} className="flex shrink-0 items-center gap-2">
            <div
              className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-xs font-medium ${
                index <= step ? "bg-(--hl1) text-white" : "bg-(--surface) text-(--dim)"
              }`}
            >
              {index + 1}
            </div>
            <div className="whitespace-nowrap text-sm text-(--dim)">{label}</div>
            {index < setupSteps.length - 1 && (
              <ChevronRight className="h-4 w-4 shrink-0 text-(--border)" />
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
