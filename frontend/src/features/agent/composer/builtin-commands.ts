// Built-in slash commands. External to the core processor: this module only
// produces a ComposerCommandProvider from an injected actions surface, so the
// registry never knows what "/compact" means — and a pane that lacks an action
// (no terminal, nothing to export) simply doesn't list that command.
import type { ComposerCommand, ComposerCommandProvider } from "./command-types";

export type BuiltinComposerActions = {
  compact: () => void;
  openStatus: () => void;
  toggleBrowserTool: () => void;
  openIntegrations: () => void;
  openTerminal?: () => void;
  forkSession?: () => void;
  exportSession?: () => void;
  /** `/goal <objective>` and `/goal pause|resume|clear`. Resolves to an error message or null. */
  goal?: (args: string) => Promise<string | null>;
  enterGoalMode?: () => void;
  openAutomation?: () => void;
};

/** One plain builtin: a name, its menu copy, the action it fires (absent when
 * the pane cannot do it), and an optional availability predicate. */
type BuiltinSpec = [
  name: string,
  title: string,
  description: string,
  run: (() => void) | undefined,
  when?: ComposerCommand["when"],
];

export function builtinCommandProvider(actions: BuiltinComposerActions): ComposerCommandProvider {
  const specs: BuiltinSpec[] = [
    [
      "compact",
      "Compact",
      "Compact this chat's context",
      actions.compact,
      (context) => !context.running && !context.compacting,
    ],
    ["status", "Status", "Open the status panel", actions.openStatus],
    ["browser", "Browser", "Toggle the browser tool", actions.toggleBrowserTool],
    ["connectors", "Connectors", "Manage connectors and accounts", actions.openIntegrations],
    ["terminal", "Terminal", "Open the terminal", actions.openTerminal],
    ["fork", "Fork", "Fork this session into a new pane", actions.forkSession],
    ["export", "Export", "Export this session as Markdown", actions.exportSession],
    ["automation", "Automation", "Schedule this work to run on a timer", actions.openAutomation],
  ];

  return {
    id: "builtin",
    commands: () => [
      ...specs.flatMap(([name, title, description, run, when]): ComposerCommand[] =>
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
                  return { kind: "handled" };
                },
              },
            ]
          : [],
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
