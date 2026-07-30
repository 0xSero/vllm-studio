"use client";

import { useRouter } from "next/navigation";
import { Button, Card } from "@/ui";

export function ModePicker() {
  const router = useRouter();

  return (
    <div className="mx-auto max-w-2xl px-4 py-12">
      <div className="mb-8 text-center">
        <h1 className="text-2xl font-semibold">Welcome to Local Studio</h1>
        <p className="mt-2 text-muted-foreground">
          Choose how you&apos;d like to get started. You can switch anytime.
        </p>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <Card className="flex flex-col p-6">
          <div className="mb-2 text-3xl">🔬</div>
          <h2 className="text-lg font-semibold">I&apos;m a scientist</h2>
          <p className="mt-1 flex-1 text-sm text-muted-foreground">
            I want to analyze data, review literature, and run experiments. I&apos;d like the AI to
            handle the technical details.
          </p>
          <Button className="mt-4" onClick={() => router.push("/scientist")}>
            Scientist onboarding
          </Button>
        </Card>

        <Card className="flex flex-col p-6">
          <div className="mb-2 text-3xl">⚙️</div>
          <h2 className="text-lg font-semibold">I&apos;m a developer</h2>
          <p className="mt-1 flex-1 text-sm text-muted-foreground">
            I want to configure model serving, manage infrastructure, and tune performance. Show me
            the technical controls.
          </p>
          <Button className="mt-4" variant="secondary" onClick={() => router.push("/setup")}>
            Technical setup
          </Button>
        </Card>
      </div>

      <div className="mt-6 text-center text-sm text-muted-foreground">
        Not sure? Scientist mode is a gentler introduction — you can always switch to technical
        setup later.
      </div>
    </div>
  );
}
