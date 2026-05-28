"use client";

import { Eye, Info, Terminal } from "lucide-react";
import { Alert, Card, FormSection, Textarea } from "@/ui";

export function RecipeModalTabCommand({
  commandText,
  onCommandChange,
}: {
  commandText: string;
  onCommandChange: (value: string) => void;
}) {
  return (
    <div className="space-y-4 h-full flex flex-col">
      <FormSection icon={<Eye className="h-4 w-4" />} title="Command Preview" />

      <p className="text-xs text-(--dim)">
        Edit this launch command directly when the form does not expose the flag you need.
        <strong className="text-(--accent)"> Direct edits are saved with the recipe.</strong>
      </p>

      <Card padding="sm" className="flex flex-1 flex-col overflow-hidden">
        <div className="flex items-center gap-2 px-3 py-2 bg-(--surface) border-b border-(--border)">
          <Terminal className="w-4 h-4 text-(--dim)" />
          <span className="text-xs text-(--dim)">Generated Command</span>
        </div>
        <Textarea
          value={commandText}
          onChange={(e) => onCommandChange(e.target.value)}
          spellCheck={false}
          className="flex-1 border-0 bg-transparent px-3 py-3 font-mono text-xs leading-relaxed text-(--ui-success)"
          placeholder="Command will appear here..."
        />
      </Card>

      <Alert variant="info" icon={<Info className="h-4 w-4" />}>
        <div className="space-y-1 text-xs">
          <p>Use the form tabs to configure the recipe. This preview updates automatically.</p>
          <p>
            Once you edit the command, the saved plaintext command becomes the source of truth for
            launch.
          </p>
        </div>
      </Alert>
    </div>
  );
}
