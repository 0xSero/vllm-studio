import type { Rig, RigNode, RigsPayload } from "../types";
import { encodePathSegments, type ApiCore } from "./core";

export interface RigNodePayload {
  name?: string;
  hardware_type?: string;
  role?: string;
  hostname?: string | null;
  address?: string | null;
  os?: string | null;
  cpu_model?: string | null;
  memory_gb?: number | null;
  accelerators?: Array<{
    name: string;
    count: number;
    memory_gb: number | null;
    memory_type?: string | null;
    memory_bandwidth_gbs?: number | null;
    unified_memory?: boolean;
  }>;
  notes?: string | null;
}

export function createRigsApi(core: ApiCore) {
  return {
    getRigs: (): Promise<RigsPayload> => core.request("/studio/rigs"),

    createRig: (payload: {
      name: string;
      description?: string | null;
    }): Promise<{ success: boolean; rig: Rig }> =>
      core.request("/studio/rigs", { method: "POST", body: JSON.stringify(payload) }),

    updateRig: (
      id: string,
      payload: { name?: string; description?: string | null },
    ): Promise<{ success: boolean; rig: Rig }> =>
      core.request(`/studio/rigs/${encodePathSegments(id)}`, {
        method: "PUT",
        body: JSON.stringify(payload),
      }),

    deleteRig: (id: string): Promise<{ success: boolean }> =>
      core.request(`/studio/rigs/${encodePathSegments(id)}`, { method: "DELETE" }),

    addRigNode: (
      rigId: string,
      payload: RigNodePayload & { name: string },
    ): Promise<{ success: boolean; rig: Rig; node: RigNode }> =>
      core.request(`/studio/rigs/${encodePathSegments(rigId)}/nodes`, {
        method: "POST",
        body: JSON.stringify(payload),
      }),

    updateRigNode: (
      rigId: string,
      nodeId: string,
      payload: RigNodePayload,
    ): Promise<{ success: boolean; rig: Rig; node: RigNode }> =>
      core.request(
        `/studio/rigs/${encodePathSegments(rigId)}/nodes/${encodePathSegments(nodeId)}`,
        {
          method: "PUT",
          body: JSON.stringify(payload),
        },
      ),

    deleteRigNode: (rigId: string, nodeId: string): Promise<{ success: boolean; rig: Rig }> =>
      core.request(
        `/studio/rigs/${encodePathSegments(rigId)}/nodes/${encodePathSegments(nodeId)}`,
        {
          method: "DELETE",
        },
      ),
  };
}
