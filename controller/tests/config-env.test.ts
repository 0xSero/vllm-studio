import { afterEach, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { createConfig } from "../src/config/env";

const roots: string[] = [];
const keys = [
  "LOCAL_STUDIO_DATA_DIR",
  "LOCAL_STUDIO_NOTEBOOK_ROOT",
  "LOCAL_STUDIO_NOTEBOOK_PYTHON",
  "LOCAL_STUDIO_NOTEBOOK_SMOLVM",
  "LOCAL_STUDIO_NOTEBOOK_NODE_IMAGE",
  "LOCAL_STUDIO_NOTEBOOK_PYTHON_IMAGE",
] as const;
const original = Object.fromEntries(keys.map((key) => [key, process.env[key]]));

afterEach(async () => {
  for (const key of keys) {
    const value = original[key];
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

test("notebook environment resolves paths and trims runtime commands", async () => {
  const root = await mkdtemp(join(tmpdir(), "local-studio-config-"));
  roots.push(root);
  process.env["LOCAL_STUDIO_DATA_DIR"] = root;
  process.env["LOCAL_STUDIO_NOTEBOOK_ROOT"] = "./governed-notebooks";
  process.env["LOCAL_STUDIO_NOTEBOOK_PYTHON"] = "  /opt/notebook/python  ";
  process.env["LOCAL_STUDIO_NOTEBOOK_SMOLVM"] = "  /opt/notebook/smolvm  ";
  process.env["LOCAL_STUDIO_NOTEBOOK_NODE_IMAGE"] = "  node:22@sha256:node  ";
  process.env["LOCAL_STUDIO_NOTEBOOK_PYTHON_IMAGE"] = "  /opt/notebook/python.tar@sha256:python  ";

  const config = createConfig();

  expect(config.notebook_root).toBe(resolve("./governed-notebooks"));
  expect(config.notebook_python).toBe("/opt/notebook/python");
  expect(config.notebook_smolvm).toBe("/opt/notebook/smolvm");
  expect(config.notebook_node_image).toBe("node:22@sha256:node");
  expect(config.notebook_python_image).toBe("/opt/notebook/python.tar@sha256:python");
});

test("notebook defaults stay rooted in the controller data directory", async () => {
  const root = await mkdtemp(join(tmpdir(), "local-studio-config-"));
  roots.push(root);
  process.env["LOCAL_STUDIO_DATA_DIR"] = root;
  for (const key of keys.slice(1)) delete process.env[key];

  const config = createConfig();

  expect(config.notebook_root).toBe(join(root, "notebooks"));
  expect(config.notebook_smolvm).toBe("smolvm");
  expect(config.notebook_node_image).toBe(join(root, "node-notebook-image.tar"));
  expect(config.notebook_python_image).toBe(join(root, "python-notebook-image.tar"));
});
