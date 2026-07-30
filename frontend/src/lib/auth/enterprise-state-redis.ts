import { createHash, randomBytes } from "node:crypto";
import { createClient, WatchError, type RedisClientType } from "@redis/client";

export type RedisStateMutation<Value> = {
  expiresAt?: number;
  serialized: string | null;
  value: Value;
  write: boolean;
};
const redisUrl = (): string => {
  const configured = process.env.LOCAL_STUDIO_ENTERPRISE_REDIS_URL?.trim();
  if (!configured) throw new Error("LOCAL_STUDIO_ENTERPRISE_REDIS_URL is required");
  const url = new URL(configured);
  const loopback =
    url.hostname === "127.0.0.1" || url.hostname === "::1" || url.hostname === "localhost";
  if (url.protocol !== "rediss:" && !(url.protocol === "redis:" && loopback)) {
    throw new Error("Enterprise Redis requires rediss except on loopback");
  }
  if (url.search || url.hash) throw new Error("Enterprise Redis URL is invalid");
  return url.toString();
};
const redisNamespace = (): string => {
  const configured = process.env.LOCAL_STUDIO_ENTERPRISE_REDIS_NAMESPACE?.trim() || "local-studio";
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/u.test(configured)) {
    throw new Error("Enterprise Redis namespace is invalid");
  }
  return configured;
};

export const assertRedisStateStoreConfiguration = (): void => {
  redisUrl();
  redisNamespace();
};

const redisStateKey = (): string => `${redisNamespace()}:{enterprise-state}:records:v1`;

const redisLeaseKey = (scope: string): string =>
  `${redisNamespace()}:{enterprise-state}:lease:${createHash("sha256")
    .update(scope, "utf8")
    .digest("hex")}`;

let redisClientPromise: Promise<RedisClientType> | undefined;
let redisQueue = Promise.resolve();

const enterpriseRedisClient = (): Promise<RedisClientType> => {
  if (redisClientPromise) return redisClientPromise;
  const client = createClient({
    url: redisUrl(),
    disableOfflineQueue: true,
    socket: {
      connectTimeout: 5_000,
      reconnectStrategy: false,
    },
  });
  client.on("error", () => {});
  redisClientPromise = client.connect().then(() => {
    client.unref();
    return client as RedisClientType;
  });
  redisClientPromise.catch(() => {
    redisClientPromise = undefined;
    client.destroy();
  });
  return redisClientPromise;
};

const resetRedisClient = (client: RedisClientType): void => {
  if (redisClientPromise) redisClientPromise = undefined;
  if (client.isOpen) client.destroy();
};

const withRedisClient = <Value>(
  operation: (client: RedisClientType) => Promise<Value>,
): Promise<Value> => {
  const pending = redisQueue.then(async () => {
    const client = await enterpriseRedisClient();
    try {
      return await operation(client.withAbortSignal(AbortSignal.timeout(5_000)));
    } catch (error) {
      if (!client.isReady) resetRedisClient(client);
      throw error;
    }
  });
  redisQueue = pending.then(
    () => undefined,
    () => undefined,
  );
  return pending;
};

export const transactRedisState = <Value>(
  operation: (serialized: string | null) => RedisStateMutation<Value>,
): Promise<Value> =>
  withRedisClient(async (client) => {
    const key = redisStateKey();
    for (let attempt = 0; attempt < 40; attempt += 1) {
      await client.watch(key);
      try {
        const result = operation(await client.get(key));
        if (!result.write) {
          await client.unwatch();
          return result.value;
        }
        const transaction = client.multi();
        if (result.serialized === null) {
          transaction.del(key);
        } else {
          if (result.expiresAt === undefined) {
            throw new Error("Enterprise Redis state expiry is missing");
          }
          transaction.set(key, result.serialized, {
            expiration: { type: "PXAT", value: result.expiresAt },
          });
        }
        await transaction.exec();
        return result.value;
      } catch (error) {
        await client.unwatch().catch(() => {});
        if (error instanceof WatchError && attempt < 39) continue;
        throw error;
      }
    }
    throw new Error("Enterprise Redis transaction did not converge");
  });

const renewRedisLease =
  "if redis.call('GET', KEYS[1]) == ARGV[1] then return redis.call('PEXPIRE', KEYS[1], ARGV[2]) else return 0 end";
const releaseRedisLease =
  "if redis.call('GET', KEYS[1]) == ARGV[1] then return redis.call('DEL', KEYS[1]) else return 0 end";

export const acquireRedisStateLease = async (scope: string): Promise<() => Promise<void>> => {
  const key = redisLeaseKey(scope);
  const token = randomBytes(32).toString("base64url");
  let acquired = false;
  for (let attempt = 0; attempt < 160; attempt += 1) {
    acquired = await withRedisClient(async (client) =>
      Boolean(
        await client.set(key, token, {
          condition: "NX",
          expiration: { type: "PX", value: 30_000 },
        }),
      ),
    );
    if (acquired) break;
    await new Promise((resolveDelay) =>
      setTimeout(resolveDelay, Math.min(25 * 1.2 ** attempt, 250)),
    );
  }
  if (!acquired) throw new Error("Enterprise Redis lease could not be acquired");
  let lost = false;
  let active = true;
  const heartbeat = setInterval(() => {
    void withRedisClient(async (client) => {
      const renewed = await client.eval(renewRedisLease, {
        keys: [key],
        arguments: [token, "30000"],
      });
      if (renewed !== 1) lost = true;
    }).catch(() => {
      lost = true;
    });
  }, 5_000);
  heartbeat.unref();
  return async () => {
    if (!active) return;
    active = false;
    clearInterval(heartbeat);
    const released = await withRedisClient(async (client) =>
      client.eval(releaseRedisLease, {
        keys: [key],
        arguments: [token],
      }),
    );
    if (lost || released !== 1) throw new Error("Enterprise Redis lease ownership was lost");
  };
};
