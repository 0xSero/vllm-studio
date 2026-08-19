export type ExclusiveLane = "omlx" | "ds4";
export type ResidentLane = ExclusiveLane | "none" | "conflict";

const USER_PI_PREFIX = "user-pi-";
const DEFAULT_CHAT_PROVIDER = "openai";

const providerSegment = (rawModel: string): string => {
  const trimmed = rawModel.trim();
  if (!trimmed) {
    return DEFAULT_CHAT_PROVIDER;
  }
  const delimiter = trimmed.indexOf("/");
  if (delimiter > 0 && delimiter < trimmed.length - 1) {
    const provider = trimmed.slice(0, delimiter).trim();
    const modelId = trimmed.slice(delimiter + 1).trim();
    if (modelId.length > 0) {
      return provider || DEFAULT_CHAT_PROVIDER;
    }
  }
  return DEFAULT_CHAT_PROVIDER;
};

export function exclusiveLaneOf(rawModel: string): ExclusiveLane | null {
  let canonical = providerSegment(rawModel).trim().toLowerCase();
  while (canonical.startsWith(USER_PI_PREFIX)) {
    canonical = canonical.slice(USER_PI_PREFIX.length);
  }
  if (canonical === "omlx") return "omlx";
  if (canonical === "ds4") return "ds4";
  return null;
}

export function shouldRequestLaneSwitch(
  nextModelId: string,
  residentLane: ResidentLane | "unknown",
): ExclusiveLane | null {
  const to = exclusiveLaneOf(nextModelId);
  if (!to) return null;
  if (residentLane === "unknown") return null;
  if (residentLane === to) return null;
  return to;
}
