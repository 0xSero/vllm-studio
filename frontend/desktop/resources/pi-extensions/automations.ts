import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { Schema } from "effect";
import { requestJson, result } from "./first-party-tool.ts";

const FRONTEND_BASE = process.env.LOCAL_STUDIO_FRONTEND_BASE ?? "http://127.0.0.1:3000";
const CALL_TIMEOUT_MS = 30_000;
const RUN_TIMEOUT_MS = 15 * 60_000;

type AutomationDetails =
  | { failed: true }
  | { count: number; automations?: AutomationRecord[] }
  | { id: string; schedule?: NormalizedSchedule; modelId?: string };

type IntervalSchedule = { kind: "interval"; minutes: number };
type DailySchedule = { kind: "daily"; time: string; weekdaysOnly?: boolean };
type WeeklySchedule = { kind: "weekly"; day: number; time: string };
export type NormalizedSchedule = IntervalSchedule | DailySchedule | WeeklySchedule;

const TimeSchema = Schema.String.check(Schema.isPattern(/^([01]?\d|2[0-3]):[0-5]\d$/));
const NormalizedScheduleSchema = Schema.Union([
  Schema.Struct({ kind: Schema.Literal("interval"), minutes: Schema.Number }),
  Schema.Struct({
    kind: Schema.Literal("daily"),
    time: Schema.String,
    weekdaysOnly: Schema.optional(Schema.Boolean),
  }),
  Schema.Struct({ kind: Schema.Literal("weekly"), day: Schema.Number, time: Schema.String }),
]);
const AutomationRecordSchema = Schema.Struct({
  id: Schema.optional(Schema.String),
  name: Schema.optional(Schema.String),
  status: Schema.optional(Schema.String),
  nextRunAt: Schema.optional(Schema.String),
  prompt: Schema.optional(Schema.String),
  modelId: Schema.optional(Schema.String),
  cwd: Schema.optional(Schema.String),
  schedule: Schema.optional(NormalizedScheduleSchema),
});
const AutomationUpdateSchema = Schema.Struct({
  name: Schema.optional(Schema.String),
  prompt: Schema.optional(Schema.String),
  modelId: Schema.optional(Schema.String),
  cwd: Schema.optional(Schema.String),
});
const ErrorResponseSchema = Schema.Struct({ error: Schema.String });
const ModelsResponseSchema = Schema.Struct({
  models: Schema.Array(Schema.Struct({ id: Schema.String })),
});
const CreatedAutomationResponseSchema = Schema.Struct({
  automation: Schema.optional(AutomationRecordSchema),
});
const AutomationsResponseSchema = Schema.Struct({
  automations: Schema.Array(AutomationRecordSchema),
});
const HttpResponseSchema = Schema.Union([
  ModelsResponseSchema,
  AutomationsResponseSchema,
  CreatedAutomationResponseSchema,
  ErrorResponseSchema,
]);
type HttpResponse = typeof HttpResponseSchema.Type;
type HttpJsonBody = HttpResponse | null;

type ScheduleArg = {
  kind?: unknown;
  minutes?: unknown;
  time?: unknown;
  day?: unknown;
  weekdaysOnly?: unknown;
};

const WEEKDAY_NAMES = [
  "Sunday",
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
];

export function normalizeScheduleArg(
  input: ScheduleArg | undefined,
): { ok: true; schedule: NormalizedSchedule } | { ok: false; error: string } {
  if (!input) {
    return { ok: false, error: "schedule is required (an object with a 'kind')." };
  }
  const kind = input.kind;
  if (kind === "interval") {
    const parsedMinutes = Schema.decodeUnknownOption(Schema.Number)(input.minutes);
    const minutes = parsedMinutes._tag === "Some" ? Math.round(parsedMinutes.value) : NaN;
    if (!Number.isFinite(minutes) || minutes < 1) {
      return { ok: false, error: "interval schedule needs 'minutes' >= 1." };
    }
    return { ok: true, schedule: { kind: "interval", minutes } };
  }
  if (kind === "daily") {
    const parsedTime = Schema.decodeUnknownOption(TimeSchema)(input.time);
    const time = parsedTime._tag === "Some" ? parsedTime.value.trim() : null;
    if (!time) {
      return { ok: false, error: "daily schedule needs 'time' as 'HH:MM' (24h)." };
    }
    const schedule: DailySchedule = { kind: "daily", time };
    if (input.weekdaysOnly === true) schedule.weekdaysOnly = true;
    return { ok: true, schedule };
  }
  if (kind === "weekly") {
    const parsedDay = Schema.decodeUnknownOption(Schema.Number)(input.day);
    const day = parsedDay._tag === "Some" ? Math.round(parsedDay.value) : NaN;
    if (![0, 1, 2, 3, 4, 5, 6].includes(day)) {
      return { ok: false, error: "weekly schedule needs 'day' 0-6 (0 = Sunday)." };
    }
    const parsedTime = Schema.decodeUnknownOption(TimeSchema)(input.time);
    const time = parsedTime._tag === "Some" ? parsedTime.value.trim() : null;
    if (!time) {
      return { ok: false, error: "weekly schedule needs 'time' as 'HH:MM' (24h)." };
    }
    return { ok: true, schedule: { kind: "weekly", day, time } };
  }
  return { ok: false, error: "schedule.kind must be 'interval', 'daily' or 'weekly'." };
}

export function describeSchedule(schedule: NormalizedSchedule): string {
  if (schedule.kind === "interval") return `every ${schedule.minutes} min`;
  if (schedule.kind === "daily") {
    return `daily at ${schedule.time}${schedule.weekdaysOnly ? " (weekdays)" : ""}`;
  }
  return `weekly on ${WEEKDAY_NAMES[schedule.day] ?? `day ${schedule.day}`} at ${schedule.time}`;
}

async function httpJson(
  path: string,
  init: RequestInit,
  signal: AbortSignal | undefined,
  timeoutMs = CALL_TIMEOUT_MS,
): Promise<{ ok: boolean; status: number; body: HttpJsonBody }> {
  const response = await requestJson(`${FRONTEND_BASE}${path}`, init, signal, timeoutMs);
  const parsed = Schema.decodeUnknownOption(HttpResponseSchema)(response.body);
  return {
    ok: response.ok,
    status: response.status,
    body: parsed._tag === "Some" ? parsed.value : null,
  };
}

function errorText(body: HttpJsonBody, status: number): string {
  const parsed = Schema.decodeUnknownOption(ErrorResponseSchema)(body);
  return parsed._tag === "Some" ? parsed.value.error : `HTTP ${status}`;
}

async function resolveModelId(
  explicit: string | undefined,
  signal: AbortSignal | undefined,
): Promise<string | null> {
  const trimmed = explicit?.trim();
  if (trimmed) return trimmed;
  const envModel = process.env.LOCAL_STUDIO_MODEL_ID?.trim();
  if (envModel) return envModel;
  const { ok, body } = await httpJson("/api/agent/models", { method: "GET" }, signal);
  if (!ok) return null;
  const parsed = Schema.decodeUnknownOption(ModelsResponseSchema)(body);
  if (parsed._tag === "None") return null;
  for (const model of parsed.value.models) {
    const id = model.id.trim();
    if (id) return id;
  }
  return null;
}

function resolveCwd(explicit: string | undefined): string {
  const trimmed = explicit?.trim();
  if (trimmed) return trimmed;
  return process.env.LOCAL_STUDIO_CWD?.trim() ?? "";
}

type AutomationRecord = typeof AutomationRecordSchema.Type;

function formatAutomationLine(record: AutomationRecord): string {
  const id = record.id ?? "(no id)";
  const name = record.name || "Untitled";
  const status = record.status === "paused" ? "paused" : "active";
  const scheduleText = record.schedule ? describeSchedule(record.schedule) : "unknown schedule";
  const next = record.nextRunAt ? `, next ${record.nextRunAt}` : "";
  return `- ${name} [${id}] — ${scheduleText}, ${status}${next}`;
}

export default function automationsExtension(pi: ExtensionAPI): void {
  pi.registerTool({
    name: "schedule_automation",
    label: "Schedule automation",
    description:
      "Create a scheduled automation: a saved prompt the app re-runs on a schedule in its own " +
      "fresh session. Use for recurring work (a daily digest, an hourly check). Provide the " +
      "prompt to run and a schedule (interval minutes, or a daily/weekly time in 24h HH:MM). " +
      "The run uses the current model unless you pass one. Returns the created automation.",
    parameters: Type.Object({
      prompt: Type.String({ description: "The instruction the automation runs each time." }),
      schedule: Type.Object(
        {
          kind: Type.Union(
            [Type.Literal("interval"), Type.Literal("daily"), Type.Literal("weekly")],
            { description: "interval = every N minutes; daily/weekly = at a clock time" },
          ),
          minutes: Type.Optional(Type.Number({ description: "interval only: minutes, >= 1" })),
          time: Type.Optional(Type.String({ description: "daily/weekly only: 'HH:MM' 24h" })),
          day: Type.Optional(Type.Number({ description: "weekly only: 0-6, 0 = Sunday" })),
          weekdaysOnly: Type.Optional(
            Type.Boolean({ description: "daily only: skip Saturday/Sunday" }),
          ),
        },
        { description: "When to run." },
      ),
      name: Type.Optional(Type.String({ description: "Short display name." })),
      model: Type.Optional(
        Type.String({ description: "Model id; defaults to the current session's model." }),
      ),
      cwd: Type.Optional(
        Type.String({ description: "Working directory; defaults to the current project." }),
      ),
    }),
    async execute(_id, params, signal) {
      const args = params;
      const prompt = args.prompt.trim();
      if (!prompt)
        return result<AutomationDetails>("schedule_automation needs a non-empty prompt.", {
          failed: true,
        });
      const scheduleResult = normalizeScheduleArg(args.schedule);
      if (!scheduleResult.ok)
        return result<AutomationDetails>(scheduleResult.error, { failed: true });
      try {
        const modelId = await resolveModelId(args.model, signal);
        if (!modelId) {
          return result<AutomationDetails>(
            "No model available to run the automation. Pass a 'model' id.",
            {
              failed: true,
            },
          );
        }
        const { ok, status, body } = await httpJson(
          "/api/agent/automations",
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              name: args.name ?? "",
              prompt,
              modelId,
              cwd: resolveCwd(args.cwd),
              schedule: scheduleResult.schedule,
            }),
          },
          signal,
        );
        if (!ok)
          return result<AutomationDetails>(
            `Failed to create automation: ${errorText(body, status)}`,
            {
              failed: true,
            },
          );
        const parsedBody = Schema.decodeUnknownOption(CreatedAutomationResponseSchema)(body);
        const automation = parsedBody._tag === "Some" ? parsedBody.value.automation : undefined;
        const id = [automation?.id, "(unknown)"].filter(Boolean).slice(0, 1).join("");
        return result<AutomationDetails>(
          `Created automation "${automation?.name ?? args.name ?? "Untitled"}" [${id}] — ` +
            `${describeSchedule(scheduleResult.schedule)}. Next run ${automation?.nextRunAt ?? "pending"}.`,
          { id, schedule: scheduleResult.schedule, modelId },
        );
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return result<AutomationDetails>(`Failed to create automation: ${message}`, {
          failed: true,
        });
      }
    },
  });

  pi.registerTool({
    name: "list_automations",
    label: "List automations",
    description: "List the scheduled automations: name, id, schedule, status and next run time.",
    parameters: Type.Object({}),
    async execute(_id, _params, signal) {
      try {
        const { ok, status, body } = await httpJson(
          "/api/agent/automations",
          { method: "GET" },
          signal,
        );
        if (!ok)
          return result<AutomationDetails>(
            `Failed to list automations: ${errorText(body, status)}`,
            {
              failed: true,
            },
          );
        const parsedBody = Schema.decodeUnknownOption(AutomationsResponseSchema)(body);
        const automations = parsedBody._tag === "Some" ? parsedBody.value.automations : [];
        if (automations.length === 0)
          return result<AutomationDetails>("No automations are scheduled.", { count: 0 });
        const lines = automations.map(formatAutomationLine);
        return result<AutomationDetails>(
          `${automations.length} automation(s):\n${lines.join("\n")}`,
          {
            count: automations.length,
          },
        );
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return result<AutomationDetails>(`Failed to list automations: ${message}`, {
          failed: true,
        });
      }
    },
  });

  pi.registerTool({
    name: "read_automation",
    label: "Read automation",
    description:
      "Read one automation, including its prompt, schedule, model, directory and run state.",
    parameters: Type.Object({ id: Type.String({ description: "Automation id." }) }),
    async execute(_id, params, signal) {
      const id = params.id.trim();
      if (!id)
        return result<AutomationDetails>("read_automation needs an automation id.", {
          failed: true,
        });
      try {
        const response = await httpJson(
          `/api/agent/automations/${encodeURIComponent(id)}`,
          { method: "GET" },
          signal,
        );
        if (!response.ok) {
          return result<AutomationDetails>(
            `Failed to read automation: ${errorText(response.body, response.status)}`,
            {
              failed: true,
            },
          );
        }
        const parsed = Schema.decodeUnknownOption(CreatedAutomationResponseSchema)(response.body);
        if (parsed._tag === "None" || !parsed.value.automation) {
          return result<AutomationDetails>("Automation response was invalid.", { failed: true });
        }
        const automation = parsed.value.automation;
        return result<AutomationDetails>(JSON.stringify(automation, null, 2), { id });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return result<AutomationDetails>(`Failed to read automation: ${message}`, { failed: true });
      }
    },
  });

  pi.registerTool({
    name: "update_automation",
    label: "Update automation",
    description: "Update an automation's name, prompt, model or working directory.",
    parameters: Type.Object({
      id: Type.String({ description: "Automation id." }),
      name: Type.Optional(Type.String()),
      prompt: Type.Optional(Type.String()),
      modelId: Type.Optional(Type.String()),
      cwd: Type.Optional(Type.String()),
    }),
    async execute(_id, params, signal) {
      const id = params.id.trim();
      if (!id)
        return result<AutomationDetails>("update_automation needs an automation id.", {
          failed: true,
        });
      const update = Schema.decodeUnknownSync(AutomationUpdateSchema)({
        name: params.name,
        prompt: params.prompt,
        modelId: params.modelId,
        cwd: params.cwd,
      });
      try {
        const response = await httpJson(
          `/api/agent/automations/${encodeURIComponent(id)}`,
          {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(update),
          },
          signal,
        );
        if (!response.ok) {
          return result<AutomationDetails>(
            `Failed to update automation: ${errorText(response.body, response.status)}`,
            {
              failed: true,
            },
          );
        }
        return result<AutomationDetails>(`Updated automation ${id}.`, { id });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return result<AutomationDetails>(`Failed to update automation: ${message}`, {
          failed: true,
        });
      }
    },
  });

  pi.registerTool({
    name: "set_automation_status",
    label: "Pause or resume automation",
    description: "Pause or resume a scheduled automation.",
    parameters: Type.Object({
      id: Type.String({ description: "Automation id." }),
      status: Type.Union([Type.Literal("active"), Type.Literal("paused")]),
    }),
    async execute(_id, params, signal) {
      const id = params.id.trim();
      if (!id)
        return result<AutomationDetails>("set_automation_status needs an automation id.", {
          failed: true,
        });
      try {
        const response = await httpJson(
          `/api/agent/automations/${encodeURIComponent(id)}`,
          {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ status: params.status }),
          },
          signal,
        );
        if (!response.ok) {
          return result<AutomationDetails>(
            `Failed to update automation: ${errorText(response.body, response.status)}`,
            {
              failed: true,
            },
          );
        }
        return result<AutomationDetails>(
          `${params.status === "paused" ? "Paused" : "Resumed"} automation ${id}.`,
          { id },
        );
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return result<AutomationDetails>(`Failed to update automation: ${message}`, {
          failed: true,
        });
      }
    },
  });

  pi.registerTool({
    name: "run_automation_now",
    label: "Run automation now",
    description:
      "Run an automation immediately in a fresh session and wait for its recorded result.",
    parameters: Type.Object({ id: Type.String({ description: "Automation id." }) }),
    async execute(_id, params, signal) {
      const id = params.id.trim();
      if (!id)
        return result<AutomationDetails>("run_automation_now needs an automation id.", {
          failed: true,
        });
      try {
        const response = await httpJson(
          `/api/agent/automations/${encodeURIComponent(id)}/run`,
          { method: "POST" },
          signal,
          RUN_TIMEOUT_MS,
        );
        if (!response.ok) {
          return result<AutomationDetails>(
            `Automation run failed: ${errorText(response.body, response.status)}`,
            {
              failed: true,
            },
          );
        }
        return result<AutomationDetails>(
          `Automation ${id} finished. Read it for the recorded run history.`,
          {
            id,
          },
        );
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return result<AutomationDetails>(`Automation run failed: ${message}`, { failed: true });
      }
    },
  });

  pi.registerTool({
    name: "delete_automation",
    label: "Delete automation",
    description: "Delete a scheduled automation by its id (get ids from list_automations).",
    parameters: Type.Object({
      id: Type.String({ description: "The automation id, e.g. 'auto-1a2b3c4d'." }),
    }),
    async execute(_id, params, signal) {
      const id = params.id.trim();
      if (!id)
        return result<AutomationDetails>("delete_automation needs an automation id.", {
          failed: true,
        });
      try {
        const { ok, status, body } = await httpJson(
          `/api/agent/automations/${encodeURIComponent(id)}`,
          { method: "DELETE" },
          signal,
        );
        if (!ok)
          return result<AutomationDetails>(
            `Failed to delete automation: ${errorText(body, status)}`,
            {
              failed: true,
            },
          );
        return result<AutomationDetails>(`Deleted automation ${id}.`, { id });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return result<AutomationDetails>(`Failed to delete automation: ${message}`, {
          failed: true,
        });
      }
    },
  });
}
