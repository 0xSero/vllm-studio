import { randomUUID } from "node:crypto";
import { CONTROLLER_EVENTS } from "@local-studio/contracts/controller-events";
import {
  RIG_HARDWARE_TYPES,
  RIG_NODE_ROLES,
  type Rig,
  type RigAccelerator,
  type RigHardwareType,
  type RigNode,
  type RigNodeRole,
  type RigsPayload,
} from "@local-studio/contracts/rigs";
import { badRequest, notFound } from "../../core/errors";
import { parseJsonObjectBody } from "../../core/validation";
import type { RouteRegistrar } from "../../http/route-registrar";
import { Event } from "../system/event-manager";
import {
  buildDetectedNode,
  refreshLocalNode,
  seedDefaultRig,
  LOCAL_RIG_NODE_ID,
} from "./rig-detection";

const parseRequiredName = (value: unknown): string => {
  const name = typeof value === "string" ? value.trim() : "";
  if (!name) throw badRequest("name is required");
  return name;
};

const parseOptionalString = (value: unknown, current: string | null): string | null => {
  if (value === undefined) return current;
  if (value === null) return null;
  if (typeof value !== "string") throw badRequest("Expected string or null");
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
};

const parseHardwareType = (value: unknown, current: RigHardwareType): RigHardwareType => {
  if (value === undefined) return current;
  if (typeof value !== "string" || !RIG_HARDWARE_TYPES.includes(value as RigHardwareType)) {
    throw badRequest(`hardware_type must be one of: ${RIG_HARDWARE_TYPES.join(", ")}`);
  }
  return value as RigHardwareType;
};

const parseRole = (value: unknown, current: RigNodeRole): RigNodeRole => {
  if (value === undefined) return current;
  if (typeof value !== "string" || !RIG_NODE_ROLES.includes(value as RigNodeRole)) {
    throw badRequest(`role must be one of: ${RIG_NODE_ROLES.join(", ")}`);
  }
  return value as RigNodeRole;
};

const parseAccelerators = (value: unknown, current: RigAccelerator[]): RigAccelerator[] => {
  if (value === undefined) return current;
  if (!Array.isArray(value)) throw badRequest("accelerators must be an array");
  return value.map((entry) => {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
      throw badRequest("Each accelerator must be an object");
    }
    const record = entry as Record<string, unknown>;
    const name = typeof record["name"] === "string" ? record["name"].trim() : "";
    if (!name) throw badRequest("accelerator name is required");
    const count = Number(record["count"] ?? 1);
    if (!Number.isInteger(count) || count < 1) {
      throw badRequest("accelerator count must be a positive integer");
    }
    const rawMemoryGb = record["memory_gb"];
    const memoryGb = rawMemoryGb === null || rawMemoryGb === undefined ? null : Number(rawMemoryGb);
    if (memoryGb !== null && (!Number.isFinite(memoryGb) || memoryGb <= 0)) {
      throw badRequest("accelerator memory_gb must be a positive number");
    }
    const rawBandwidth = record["memory_bandwidth_gbs"];
    const bandwidth =
      rawBandwidth === null || rawBandwidth === undefined ? null : Number(rawBandwidth);
    if (bandwidth !== null && (!Number.isFinite(bandwidth) || bandwidth <= 0)) {
      throw badRequest("accelerator memory_bandwidth_gbs must be a positive number");
    }
    return {
      name,
      count,
      memory_gb: memoryGb,
      memory_type:
        typeof record["memory_type"] === "string" && record["memory_type"].trim()
          ? record["memory_type"].trim()
          : null,
      memory_bandwidth_gbs: bandwidth,
      unified_memory: record["unified_memory"] === true,
    };
  });
};

const parseNumberOrNull = (value: unknown, current: number | null, label: string): number | null => {
  if (value === undefined) return current;
  if (value === null) return null;
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) throw badRequest(`${label} must be a positive number`);
  return parsed;
};

export const registerStudioRigRoutes: RouteRegistrar = (app, context) => {
  const store = context.stores.rigStore;

  const publishRigUpdate = async (): Promise<void> => {
    await context.eventManager.publish(new Event(CONTROLLER_EVENTS.RIG_UPDATED, {}));
  };

  const loadRigsWithLocalNode = (): Rig[] => {
    const rigs = store.list();
    const detected = buildDetectedNode();
    const refreshed = refreshLocalNode(rigs, detected);
    if (refreshed) {
      store.save(refreshed);
      return rigs;
    }
    const seeded = seedDefaultRig(detected);
    store.save(seeded);
    return [...rigs, seeded];
  };

  const requireRig = (rigId: string): Rig => {
    const rig = store.get(rigId);
    if (!rig) throw notFound(`Rig "${rigId}" not found`);
    return rig;
  };

  const saveRigTouched = (rig: Rig): Rig => {
    const touched = { ...rig, updated_at: new Date().toISOString() };
    store.save(touched);
    return touched;
  };

  app.get("/studio/rigs", async (ctx) => {
    const payload: RigsPayload = {
      rigs: loadRigsWithLocalNode(),
      local_node_id: LOCAL_RIG_NODE_ID,
    };
    return ctx.json(payload);
  });

  app.post("/studio/rigs", async (ctx) => {
    const body = await parseJsonObjectBody(ctx);
    const now = new Date().toISOString();
    const rig: Rig = {
      id: randomUUID(),
      name: parseRequiredName(body["name"]),
      description: parseOptionalString(body["description"], null),
      nodes: [],
      created_at: now,
      updated_at: now,
    };
    store.save(rig);
    await publishRigUpdate();
    return ctx.json({ success: true, rig });
  });

  app.put("/studio/rigs/:rigId", async (ctx) => {
    const rig = requireRig(ctx.req.param("rigId"));
    const body = await parseJsonObjectBody(ctx);
    const updated = saveRigTouched({
      ...rig,
      name: body["name"] === undefined ? rig.name : parseRequiredName(body["name"]),
      description: parseOptionalString(body["description"], rig.description),
    });
    await publishRigUpdate();
    return ctx.json({ success: true, rig: updated });
  });

  app.delete("/studio/rigs/:rigId", async (ctx) => {
    const rigId = ctx.req.param("rigId");
    if (!store.delete(rigId)) throw notFound(`Rig "${rigId}" not found`);
    await publishRigUpdate();
    return ctx.json({ success: true });
  });

  app.post("/studio/rigs/:rigId/nodes", async (ctx) => {
    const rig = requireRig(ctx.req.param("rigId"));
    const body = await parseJsonObjectBody(ctx);
    const node: RigNode = {
      id: randomUUID(),
      name: parseRequiredName(body["name"]),
      hardware_type: parseHardwareType(body["hardware_type"], "custom"),
      role: parseRole(body["role"], "standalone"),
      source: "manual",
      hostname: parseOptionalString(body["hostname"], null),
      address: parseOptionalString(body["address"], null),
      os: parseOptionalString(body["os"], null),
      cpu_model: parseOptionalString(body["cpu_model"], null),
      cpu_cores: null,
      memory_gb: parseNumberOrNull(body["memory_gb"], null, "memory_gb"),
      accelerators: parseAccelerators(body["accelerators"], []),
      notes: parseOptionalString(body["notes"], null),
    };
    const updated = saveRigTouched({ ...rig, nodes: [...rig.nodes, node] });
    await publishRigUpdate();
    return ctx.json({ success: true, rig: updated, node });
  });

  app.put("/studio/rigs/:rigId/nodes/:nodeId", async (ctx) => {
    const rig = requireRig(ctx.req.param("rigId"));
    const nodeId = ctx.req.param("nodeId");
    const index = rig.nodes.findIndex((node) => node.id === nodeId);
    const current = index >= 0 ? rig.nodes[index] : undefined;
    if (!current) throw notFound(`Node "${nodeId}" not found`);
    const body = await parseJsonObjectBody(ctx);
    const updatedNode: RigNode = {
      ...current,
      name: body["name"] === undefined ? current.name : parseRequiredName(body["name"]),
      hardware_type: parseHardwareType(body["hardware_type"], current.hardware_type),
      role: parseRole(body["role"], current.role),
      hostname: parseOptionalString(body["hostname"], current.hostname),
      address: parseOptionalString(body["address"], current.address),
      os: parseOptionalString(body["os"], current.os),
      cpu_model: parseOptionalString(body["cpu_model"], current.cpu_model),
      memory_gb: parseNumberOrNull(body["memory_gb"], current.memory_gb, "memory_gb"),
      accelerators: parseAccelerators(body["accelerators"], current.accelerators),
      notes: parseOptionalString(body["notes"], current.notes),
    };
    const nodes = [...rig.nodes];
    nodes[index] = updatedNode;
    const updated = saveRigTouched({ ...rig, nodes });
    await publishRigUpdate();
    return ctx.json({ success: true, rig: updated, node: updatedNode });
  });

  app.delete("/studio/rigs/:rigId/nodes/:nodeId", async (ctx) => {
    const rig = requireRig(ctx.req.param("rigId"));
    const nodeId = ctx.req.param("nodeId");
    if (nodeId === LOCAL_RIG_NODE_ID) {
      throw badRequest("The detected local node cannot be removed");
    }
    if (!rig.nodes.some((node) => node.id === nodeId)) {
      throw notFound(`Node "${nodeId}" not found`);
    }
    const updated = saveRigTouched({
      ...rig,
      nodes: rig.nodes.filter((node) => node.id !== nodeId),
    });
    await publishRigUpdate();
    return ctx.json({ success: true, rig: updated });
  });
};
