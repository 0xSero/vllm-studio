import { parseProviderModel } from "./provider-routing";

export type { ExclusiveLane, ResidentLane } from "../../../shared/agent/lane-identity";
import type { ExclusiveLane } from "../../../shared/agent/lane-identity";

const USER_PI_PREFIX = "user-pi-";

export const exclusiveLaneOf = (rawModel: string): ExclusiveLane | null => {
  const { provider } = parseProviderModel(rawModel);
  let canonical = provider.trim().toLowerCase();
  while (canonical.startsWith(USER_PI_PREFIX)) {
    canonical = canonical.slice(USER_PI_PREFIX.length);
  }
  if (canonical === "omlx") return "omlx";
  if (canonical === "ds4") return "ds4";
  return null;
};

