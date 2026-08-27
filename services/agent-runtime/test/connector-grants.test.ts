import { afterAll, beforeEach, expect, test } from "bun:test";
import { rmSync, writeFileSync } from "node:fs";
import { cleanTemps, tempDir } from "./test-fixtures";

process.env.LOCAL_STUDIO_DATA_DIR = tempDir("connector-grants-");
const grants = await import("../src/connector-grants");
const { resolveConnectorsFilePath } = await import("../src/connectors-service");
afterAll(cleanTemps);
beforeEach(() => {
  rmSync(grants.resolveConnectorGrantsFilePath(), { force: true });
  writeFileSync(
    resolveConnectorsFilePath(),
    JSON.stringify({
      connectors: [
        { id: "notes", name: "Notes", transport: "stdio", command: "notes", enabled: true },
      ],
    }),
  );
});

const seed = () => grants.listConnectorGrants();
const set = (tools: string[]) =>
  grants.setConnectorGrant({
    modelId: "provider/model-a",
    connectorId: "notes",
    tools,
  });

test("new connectors grant every model", async () => {
  const rows = await seed();
  expect(rows).toHaveLength(1);
  expect(rows[0]?.modelId).toBe(grants.EVERY_MODEL);
  expect(grants.resolveGrantedTools(rows, "provider/model-a", "notes")).toBe("all");
});

test("a specific grant does not narrow an open grant", async () => {
  await seed();
  expect(grants.resolveGrantedTools(await set(["read_note"]), "provider/model-a", "notes")).toBe(
    "all",
  );
});

test("revoking the open grant preserves only specific models", async () => {
  await seed();
  await set(["read_note"]);
  const rows = await grants.removeConnectorGrant(grants.EVERY_MODEL, "notes");
  expect(grants.resolveGrantedTools(rows, "provider/model-a", "notes")).toEqual(["read_note"]);
  expect(grants.resolveGrantedTools(rows, "provider/model-b", "notes")).toEqual([]);
});

test("reads do not reopen a revoked connector", async () => {
  await seed();
  await grants.removeConnectorGrant(grants.EVERY_MODEL, "notes");
  expect(await seed()).toHaveLength(0);
});

test("an empty tool list is a revocation", async () => {
  await seed();
  await grants.removeConnectorGrant(grants.EVERY_MODEL, "notes");
  expect(await set([])).toHaveLength(0);
});
