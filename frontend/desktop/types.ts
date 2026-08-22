import { Schema } from "effect";

export type DesktopAppState = "starting" | "ready" | "stopping";

export const DesktopUpdateChannelSchema = Schema.Literals(["stable", "nightly"]);
export type DesktopUpdateChannel = typeof DesktopUpdateChannelSchema.Type;

export interface DesktopServerRuntime {
  port: number;
  url: string;
  mode: "dev-server" | "embedded-standalone";
}

export interface DesktopUpdateSnapshot {
  channel: DesktopUpdateChannel;
  status:
    | "idle"
    | "checking"
    | "available"
    | "not-available"
    | "downloading"
    | "downloaded"
    | "error";
  version?: string;
  message?: string;
  progress?: number;
}
