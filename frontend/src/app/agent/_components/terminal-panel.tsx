"use client";

import { FormEvent, useState } from "react";
import type { TerminalRunResult } from "@/lib/agent/contracts/terminal";

type Entry = TerminalRunResult & { id: string };

export function TerminalPanel({ cwd }: { cwd: string | null }) {
  const [command, setCommand] = useState("pwd");
  const [running, setRunning] = useState(false);
  const [entries, setEntries] = useState<Entry[]>([]);

  async function run(event: FormEvent) {
    event.preventDefault();
    if (!cwd || !command.trim() || running) return;
    setRunning(true);
    try {
      const response = await fetch(`/api/agent/terminal?cwd=${encodeURIComponent(cwd)}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ command: command.trim() }),
      });
      const payload = (await response.json()) as TerminalRunResult;
      setEntries((current) => [{ ...payload, id: crypto.randomUUID() }, ...current].slice(0, 20));
    } catch (error) {
      setEntries((current) => [
        {
          id: crypto.randomUUID(),
          ok: false,
          command,
          stdout: "",
          stderr: "",
          exitCode: null,
          error: error instanceof Error ? error.message : "Command failed",
        },
        ...current,
      ]);
    } finally {
      setRunning(false);
    }
  }

  return (
    <section className="flex min-h-0 flex-1 flex-col">
      <form onSubmit={run} className="flex shrink-0 gap-2 border-b border-(--border) p-2 text-xs">
        <input
          value={command}
          onChange={(event) => setCommand(event.target.value)}
          disabled={!cwd || running}
          className="h-8 min-w-0 flex-1 rounded border border-(--border) bg-(--bg) px-2 font-mono text-(--fg) outline-none disabled:opacity-45"
          placeholder={cwd ? "command" : "Choose a project first"}
        />
        <button
          type="submit"
          disabled={!cwd || running || !command.trim()}
          className="h-8 rounded border border-(--border) px-3 text-(--fg) disabled:opacity-40"
        >
          {running ? "Running" : "Run"}
        </button>
      </form>
      <div className="min-h-0 flex-1 overflow-auto p-2 font-mono text-[11px] leading-5">
        {entries.length === 0 ? (
          <div className="p-2 text-(--dim)">No terminal commands yet.</div>
        ) : null}
        {entries.map((entry) => (
          <details
            key={entry.id}
            open
            className="mb-2 rounded border border-(--border) bg-(--surface)/35"
          >
            <summary className="cursor-pointer px-2 py-1 text-(--fg)">
              <span className={entry.ok ? "text-emerald-400" : "text-red-400"}>
                {entry.ok ? "$" : `!${entry.exitCode ?? ""}`}
              </span>{" "}
              {entry.command}
            </summary>
            {entry.stdout ? (
              <pre className="whitespace-pre-wrap px-2 pb-1 text-(--fg)">{entry.stdout}</pre>
            ) : null}
            {entry.stderr || entry.error ? (
              <pre className="whitespace-pre-wrap px-2 pb-2 text-red-300">
                {entry.stderr || entry.error}
              </pre>
            ) : null}
          </details>
        ))}
      </div>
    </section>
  );
}
