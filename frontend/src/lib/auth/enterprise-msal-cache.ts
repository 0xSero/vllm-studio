import type { ICachePlugin, TokenCacheContext } from "@azure/msal-node";
import {
  acquireEnterpriseStateLease,
  getEnterpriseState,
  putEnterpriseState,
} from "./enterprise-state-store";

const CACHE_RETENTION_MS = 30 * 24 * 60 * 60_000;

type ActiveLease = {
  releaseLocal: () => void;
  releaseState: () => Promise<void>;
};

export const createEnterpriseMsalCache = (key: string): ICachePlugin => {
  let queue = Promise.resolve();
  let active: ActiveLease | null = null;

  return {
    beforeCacheAccess: async (context: TokenCacheContext): Promise<void> => {
      let releaseLocal = (): void => {};
      const previous = queue;
      queue = new Promise<void>((resolve) => {
        releaseLocal = resolve;
      });
      await previous;
      let releaseState: (() => Promise<void>) | null = null;
      try {
        releaseState = await acquireEnterpriseStateLease(`msal:${key}`);
        active = { releaseLocal, releaseState };
        const serialized = await getEnterpriseState<string>("msal", key);
        if (serialized) context.tokenCache.deserialize(serialized);
      } catch (error) {
        active = null;
        await releaseState?.();
        releaseLocal();
        throw error;
      }
    },
    afterCacheAccess: async (context: TokenCacheContext): Promise<void> => {
      const lease = active;
      active = null;
      if (!lease) throw new Error("MSAL cache access has no active lease");
      try {
        if (context.cacheHasChanged) {
          await putEnterpriseState(
            "msal",
            key,
            context.tokenCache.serialize(),
            Date.now() + CACHE_RETENTION_MS,
          );
        }
      } finally {
        await lease.releaseState();
        lease.releaseLocal();
      }
    },
  };
};
