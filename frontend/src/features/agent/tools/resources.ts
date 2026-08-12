import {
  Activity,
  FolderTree,
  GitBranch,
  Globe2,
  MessageSquarePlus,
  PanelRight,
  TerminalSquare,
  type LucideIcon,
} from "lucide-react";

export const COMPUTER_RESOURCES = [
  { tab: "status", label: "Status", description: "Runtime status", icon: Activity },
  { tab: "tools", label: "Tools", description: "Open a tool", icon: PanelRight },
  {
    tab: "side-chat",
    label: "Side chat",
    description: "Start a side conversation",
    icon: MessageSquarePlus,
  },
  { tab: "browser", label: "Browser", description: "Open a website", icon: Globe2 },
  { tab: "files", label: "Files", description: "Browse project files", icon: FolderTree },
  { tab: "diff", label: "Review", description: "Diff, commit, push, and PR", icon: GitBranch },
  {
    tab: "terminal",
    label: "Terminal",
    description: "Start an interactive shell",
    icon: TerminalSquare,
  },
] as const satisfies readonly {
  tab: string;
  label: string;
  description: string;
  icon: LucideIcon;
}[];

export type ComputerTab = (typeof COMPUTER_RESOURCES)[number]["tab"];
export const COMPUTER_TAB_IDS = COMPUTER_RESOURCES.map(({ tab }) => tab);
export const LAUNCHER_RESOURCES = COMPUTER_RESOURCES.filter(
  ({ tab }) => tab !== "status" && tab !== "tools",
);

export function computerResource(tab: ComputerTab) {
  return COMPUTER_RESOURCES.find((resource) => resource.tab === tab)!;
}
