import { randomUUID } from "node:crypto";
import { chmod, mkdir, open, readFile, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { Schema } from "effect";
import {
  RemoteProvisioningStateSchema,
  type RemoteProvisioningState,
} from "./remote-provisioning-contract";
import type { RemoteProvisioningStore } from "./remote-provisioning-port";

const empty = (): RemoteProvisioningState => ({
  version: 1,
  profile: null,
  receipt: null,
  recovery: null,
  updatedAt: new Date(0).toISOString(),
});

export class FileRemoteProvisioningStore implements RemoteProvisioningStore {
  constructor(private readonly file: string) {}

  async read(): Promise<RemoteProvisioningState> {
    try {
      return Schema.decodeUnknownSync(RemoteProvisioningStateSchema, {
        onExcessProperty: "error",
      })(JSON.parse(await readFile(this.file, "utf8")));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return empty();
      throw error;
    }
  }

  async write(state: RemoteProvisioningState): Promise<void> {
    const decoded = Schema.decodeUnknownSync(RemoteProvisioningStateSchema, {
      onExcessProperty: "error",
    })(state);
    await mkdir(path.dirname(this.file), { recursive: true, mode: 0o700 });
    const temporary = `${this.file}.tmp-${process.pid}-${randomUUID()}`;
    await writeFile(temporary, `${JSON.stringify(decoded, null, 2)}\n`, { mode: 0o600 });
    await chmod(temporary, 0o600);
    await rename(temporary, this.file);
    await chmod(this.file, 0o600);
  }

  async exclusive<A>(operation: () => Promise<A>): Promise<A> {
    await mkdir(path.dirname(this.file), { recursive: true, mode: 0o700 });
    const lock = `${this.file}.lock`;
    const deadline = Date.now() + 5_000;
    let handle;
    while (!handle) {
      try {
        handle = await open(lock, "wx", 0o600);
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "EEXIST" || Date.now() >= deadline) {
          throw error;
        }
        await new Promise((resolve) => setTimeout(resolve, 25));
      }
    }
    try {
      return await operation();
    } finally {
      await handle.close();
      await rm(lock, { force: true });
    }
  }
}
