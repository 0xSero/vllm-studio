import type { Accelerator, DeviceId, LaunchPlan } from "../contracts";


/** Docker flags a launcher must add for this plan. Empty for process launches. */
export interface DeviceRuntimeFlags {
  readonly args: readonly string[];
  readonly groupAdd: readonly string[];
}

const joined = (devices: readonly DeviceId[]): string => devices.join(",");

/** Indices for accelerators whose tooling selects by ordinal rather than UUID. */
const ordinals = (devices: readonly DeviceId[]): string =>
  devices.map((device) => device.slice(device.lastIndexOf(":") + 1)).join(",");

export const deviceEnvironment = (
  accelerator: Accelerator,
  devices: readonly DeviceId[],
): Readonly<Record<string, string>> => {
  if (devices.length === 0) return {};
  switch (accelerator) {
    case "cuda":
      return { CUDA_VISIBLE_DEVICES: joined(devices) };
    case "rocm":
      // ROCR_ gates the runtime, HIP_ gates the HIP API; setting only one leaves the
      // other seeing every card on the box.
      return { HIP_VISIBLE_DEVICES: ordinals(devices), ROCR_VISIBLE_DEVICES: ordinals(devices) };
    case "xpu":
      return { ONEAPI_DEVICE_SELECTOR: `level_zero:${ordinals(devices)}` };
    case "metal":
    case "cpu":
      // Metal exposes no device selection, and CPU has nothing to select.
      return {};
  }
};

export const dockerFlagsFor = (
  accelerator: Accelerator,
  devices: readonly DeviceId[],
): DeviceRuntimeFlags => {
  if (devices.length === 0) return { args: [], groupAdd: [] };
  switch (accelerator) {
    case "cuda":
      return { args: ["--gpus", `"device=${joined(devices)}"`], groupAdd: [] };
    case "rocm":
      return {
        args: ["--device", "/dev/kfd", "--device", "/dev/dri", "--security-opt", "seccomp=unconfined"],
        groupAdd: ["video", "render"],
      };
    case "xpu":
      return { args: ["--device", "/dev/dri"], groupAdd: ["render"] };
    case "metal":
    case "cpu":
      return { args: [], groupAdd: [] };
  }
};

/**
 * Fold device selection into a plan's environment. Runtime is taken from the plan: a
 * docker plan still gets the env vars (the container reads them) *plus* the flags the
 * launcher applies separately via `dockerFlagsFor`.
 */
export const applyDevices = (plan: LaunchPlan, accelerator: Accelerator): LaunchPlan => ({
  ...plan,
  env: { ...plan.env, ...deviceEnvironment(accelerator, plan.devices) },
});
