import type { Json } from "./studio-api";

export function ErrorText({ value }: { value: string }) {
  return value ? <p className="error">{value}</p> : null;
}
export function JsonView({ value }: { value: Json | null }) {
  return <pre>{value === null ? "Loading…" : JSON.stringify(value, null, 2)}</pre>;
}
