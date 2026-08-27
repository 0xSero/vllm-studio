// Built-in slash commands. External to the core processor: this module only
// produces a ComposerCommandProvider from an injected actions surface, so the
// registry never knows what "/compact" means — and a pane that lacks an action
// (no terminal, nothing to export) simply doesn't list that command.
import type { ComposerCommand, ComposerCommandProvider } from "./command-types";

export type BuiltinComposerActions = {
  compact: () => void;
  toggleBrowserTool: () => void;
  openIntegrations: () => void;
  openTerminal?: () => void;
  exportSession?: () => void;
  /** `/goal <objective>` and `/goal pause|resume|clear`. Resolves to an error message or null. */
  goal?: (args: string) => Promise<string | null>;
  enterGoalMode?: () => void;
  openAutomation?: () => void;
};

export function builtinCommandProvider(actions: BuiltinComposerActions): ComposerCommandProvider {
  const command = (
    name: string,
    title: string,
    description: string,
    run: (() => void) | undefined,
    when?: ComposerCommand["when"],
  ): ComposerCommand[] =>
    run
      ? [
          {
            id: `builtin:${name}`,
            name,
            title,
            description,
            source: "core",
            icon: "command",
            when,
            run: () => {
              run();
              return { kind: "handled" as const };
            },
          },
        ]
      : [];

  return {
    id: "builtin",
    commands: () => [
      ...command(
        "compact",
        "Compact",
        "Compact this chat's context",
        actions.compact,
        (context) => !context.running && !context.compacting,
      ),
      ...command("browser", "Browser", "Toggle the browser tool", actions.toggleBrowserTool),
      ...command(
        "connectors",
        "Connectors",
        "Manage connectors and accounts",
        actions.openIntegrations,
      ),
      ...command("terminal", "Terminal", "Open the terminal", actions.openTerminal),
      ...command("export", "Export", "Export this session as Markdown", actions.exportSession),
      ...command(
        "automation",
        "Automation",
        "Schedule this work to run on a timer",
        actions.openAutomation,
      ),
      ...(actions.goal
        ? [
            {
              id: "builtin:goal",
              name: "goal",
              title: "Goal",
              description: "Set a goal to keep pursuing",
              source: "core",
              icon: "command" as const,
              run: async (args: string) => {
                // Picked with nothing typed: flip the composer into goal mode
                // (pill + placeholder), matching the ChatGPT app. Inline
                // "/goal <objective>" still sets it directly.
                if (!args.trim()) {
                  actions.enterGoalMode?.();
                  return { kind: "handled" as const };
                }
                const message = await actions.goal?.(args.trim());
                return message ? { kind: "error" as const, message } : { kind: "handled" as const };
              },
            },
          ]
        : []),
    ],
  };
}
