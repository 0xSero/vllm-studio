import { format } from "node:util";
import { redactLogLine } from "./log-redaction";

const methods = ["debug", "info", "log", "warn", "error"] as const;
type ConsoleMethod = (typeof methods)[number];

const outputs: Record<ConsoleMethod, (...values: unknown[]) => void> = {
  debug: console.debug.bind(console),
  info: console.info.bind(console),
  log: console.log.bind(console),
  warn: console.warn.bind(console),
  error: console.error.bind(console),
};

export const writeControllerLogLine = (method: ConsoleMethod, rawLine: string): string => {
  const line = redactLogLine(rawLine);
  try {
    outputs[method](line.trimEnd());
  } catch {}
  return line;
};

for (const method of methods) {
  console[method] = (...values: unknown[]): void => {
    const rendered = values.length === 0 ? "" : format(values[0], ...values.slice(1));
    outputs[method](redactLogLine(rendered));
  };
}
