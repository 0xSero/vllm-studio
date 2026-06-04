"use client";

import { EmptySafeNotice } from "../list";
import { SettingsButton, SettingsGroup, SettingsInput, SettingsRow } from "../settings";

export function ManualMcpServerPanel({
  open,
  name,
  command,
  args,
  tags,
  env,
  busy,
  onToggleOpen,
  onNameChange,
  onCommandChange,
  onArgsChange,
  onTagsChange,
  onEnvChange,
  onCancel,
  onSubmit,
}: {
  open: boolean;
  name: string;
  command: string;
  args: string;
  tags: string;
  env: string;
  busy: boolean;
  onToggleOpen: () => void;
  onNameChange: (value: string) => void;
  onCommandChange: (value: string) => void;
  onArgsChange: (value: string) => void;
  onTagsChange: (value: string) => void;
  onEnvChange: (value: string) => void;
  onCancel: () => void;
  onSubmit: () => void;
}) {
  return (
    <SettingsGroup
      title="Manual MCP server"
      description="Register any stdio MCP server by launch command, args, env, and tags."
      actions={
        <SettingsButton onClick={onToggleOpen}>{open ? "Close" : "Configure"}</SettingsButton>
      }
    >
      {open ? (
        <>
          <SettingsRow
            label="Name"
            control={
              <SettingsInput value={name} onChange={onNameChange} placeholder="My MCP server" />
            }
          />
          <SettingsRow
            label="Command"
            control={<SettingsInput value={command} onChange={onCommandChange} placeholder="npx" />}
          />
          <SettingsRow
            label="Arguments"
            control={
              <SettingsInput value={args} onChange={onArgsChange} placeholder="-y @scope/server" />
            }
          />
          <SettingsRow
            label="Tags"
            control={
              <SettingsInput value={tags} onChange={onTagsChange} placeholder="coding, api" />
            }
          />
          <SettingsRow
            label="Environment"
            control={
              <textarea
                value={env}
                onChange={(event) => onEnvChange(event.target.value)}
                placeholder={"API_KEY=...\nANOTHER=..."}
                rows={4}
                className="w-full resize-none rounded-md border border-(--ui-separator) bg-(--ui-bg) px-2.5 py-1.5 text-[length:var(--fs-base)] text-(--ui-fg) outline-none placeholder:text-(--ui-muted)/50 focus:border-(--ui-info)/50"
              />
            }
          />
          <div className="flex justify-end gap-1 px-3.5 py-2">
            <SettingsButton onClick={onCancel}>Cancel</SettingsButton>
            <SettingsButton
              tone="primary"
              onClick={onSubmit}
              disabled={!name.trim() || !command.trim() || busy}
            >
              Add server
            </SettingsButton>
          </div>
        </>
      ) : (
        <EmptySafeNotice>Use a command like `npx`, `uvx`, `node`, or `python`.</EmptySafeNotice>
      )}
    </SettingsGroup>
  );
}
