import { stringField, type ParseResult, objectRecord } from "./common";

export type TerminalRunRequest = { command: string };
export type TerminalRunResult = {
  ok: boolean;
  command: string;
  stdout: string;
  stderr: string;
  exitCode: number | null;
  error?: string;
};

export function parseTerminalRunRequest(input: unknown): ParseResult<TerminalRunRequest> {
  const body = objectRecord(input);
  if (!body) return { ok: false, error: "Invalid JSON body" };
  const command = stringField(body, "command", true);
  return command.ok ? { ok: true, value: { command: command.value! } } : command;
}
