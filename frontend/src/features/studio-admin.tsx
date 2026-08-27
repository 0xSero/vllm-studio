"use client";
import { Schema } from "effect";
import { useState } from "react";
import { useMountSubscription } from "@/hooks/use-mount-subscription";
import { ErrorText, JsonView } from "./studio-ui";
import { records, request, useJson, type Json, type RecordJson } from "./studio-api";

const MutationResponseSchema = Schema.Record(Schema.String, Schema.Unknown);
const decodeMutationResponse = Schema.decodeUnknownSync(MutationResponseSchema, {
  onExcessProperty: "preserve",
});
const isString = Schema.is(Schema.String);
const isNumber = Schema.is(Schema.Number);
function text(value: Json | undefined): string {
  return isString(value) ? value : "";
}
function numberText(value: Json | undefined, fallback = ""): string {
  return isNumber(value) ? String(value) : fallback;
}
function jsonBody(value: RecordJson, method = "POST"): RequestInit {
  return { method, headers: { "content-type": "application/json" }, body: JSON.stringify(value) };
}

export function RecipeManager() {
  const state = useJson("/api/proxy/recipes");
  const status = useJson("/api/proxy/status");
  const [id, setId] = useState("");
  const [name, setName] = useState("");
  const [model, setModel] = useState("");
  const [backend, setBackend] = useState("llamacpp");
  const [message, setMessage] = useState("");
  const [pinnedRecipes, setPinnedRecipes] = useState<Set<string>>(new Set());
  useMountSubscription(() => {
    const saved = localStorage.getItem("local-studio-pinned-recipes");
    if (!saved) return;
    try {
      const decoded = Schema.decodeUnknownOption(Schema.Array(Schema.String))(JSON.parse(saved));
      if (decoded._tag === "Some") setPinnedRecipes(new Set(decoded.value));
    } catch {
      setMessage("Saved recipe pins are invalid");
    }
  }, []);
  const togglePin = (recipeId: string) => {
    setPinnedRecipes((current) => {
      const next = new Set(current);
      if (next.has(recipeId)) next.delete(recipeId);
      else next.add(recipeId);
      localStorage.setItem("local-studio-pinned-recipes", JSON.stringify([...next]));
      return next;
    });
  };
  const run = async (path: `/api/${string}`, init?: RequestInit) => {
    try {
      decodeMutationResponse(await request(path, init));
      setMessage("Recipe state reconciled with the controller");
      await Promise.all([state.reload(), status.reload()]);
    } catch (value) {
      setMessage(value instanceof Error ? value.message : String(value));
    }
  };
  const draft: RecordJson = {
    id: id || name.toLowerCase().replaceAll(" ", "-"),
    name,
    model_path: model,
    backend,
  };
  return (
    <article>
      <h2>Recipe editor</h2>
      <div className="row">
        <input value={id} onChange={(event) => setId(event.target.value)} placeholder="Recipe id" />
        <input value={name} onChange={(event) => setName(event.target.value)} placeholder="Name" />
        <input
          value={model}
          onChange={(event) => setModel(event.target.value)}
          placeholder="Local model path"
        />
        <select value={backend} onChange={(event) => setBackend(event.target.value)}>
          <option value="vllm">vLLM</option>
          <option value="sglang">SGLang</option>
          <option value="llamacpp">llama.cpp</option>
          <option value="mlx">MLX</option>
        </select>
        <button
          onClick={() =>
            run(
              id ? `/api/proxy/recipes/${encodeURIComponent(id)}` : "/api/proxy/recipes",
              jsonBody(draft, id ? "PUT" : "POST"),
            )
          }
        >
          {id ? "Save recipe" : "Create recipe"}
        </button>
      </div>
      <ErrorText value={message || state.error || status.error} />
      {records(state.data, "recipes")
        .sort(
          (left, right) =>
            Number(pinnedRecipes.has(text(right.id))) - Number(pinnedRecipes.has(text(left.id))),
        )
        .map((recipe) => {
          const recipeId = text(recipe.id);
          const label = text(recipe.name) || recipeId;
          return (
            <div className="item" key={recipeId}>
              <span>
                {label} · {text(recipe.status)}
              </span>
              <button
                onClick={() => {
                  setId(recipeId);
                  setName(label);
                  setModel(text(recipe.model_path));
                  setBackend(text(recipe.backend) || "llamacpp");
                }}
              >
                Edit
              </button>
              <button onClick={() => togglePin(recipeId)}>
                {pinnedRecipes.has(recipeId) ? "Unpin" : "Pin"}
              </button>
              <button
                onClick={() =>
                  run(`/api/proxy/launch/${encodeURIComponent(recipeId)}`, { method: "POST" })
                }
              >
                Launch
              </button>
              <button
                onClick={() =>
                  run(`/api/proxy/recipes/${encodeURIComponent(recipeId)}`, { method: "DELETE" })
                }
              >
                Delete
              </button>
            </div>
          );
        })}
      <JsonView value={status.data} />
    </article>
  );
}

export function MachineManager() {
  const rigs = useJson("/api/proxy/studio/rigs");
  const targets = useJson("/api/proxy/runtime/targets");
  const providers = useJson("/api/agent/providers");
  const [rigId, setRigId] = useState("");
  const [nodeId, setNodeId] = useState("");
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [hardwareType, setHardwareType] = useState("custom");
  const [role, setRole] = useState("standalone");
  const [hostname, setHostname] = useState("");
  const [address, setAddress] = useState("");
  const [osName, setOsName] = useState("");
  const [cpuModel, setCpuModel] = useState("");
  const [memoryGb, setMemoryGb] = useState("");
  const [notes, setNotes] = useState("");
  const [acceleratorName, setAcceleratorName] = useState("");
  const [acceleratorCount, setAcceleratorCount] = useState("1");
  const [acceleratorMemory, setAcceleratorMemory] = useState("");
  const [acceleratorType, setAcceleratorType] = useState("");
  const [acceleratorBandwidth, setAcceleratorBandwidth] = useState("");
  const [unifiedMemory, setUnifiedMemory] = useState(false);
  const [message, setMessage] = useState("");
  const run = async (path: `/api/${string}`, init?: RequestInit) => {
    try {
      decodeMutationResponse(await request(path, init));
      setMessage("Machine configuration saved locally");
      await Promise.all([rigs.reload(), targets.reload(), providers.reload()]);
    } catch (value) {
      setMessage(value instanceof Error ? value.message : String(value));
    }
  };
  const editRig = (rig: RecordJson) => {
    setRigId(text(rig.id));
    setName(text(rig.name));
    setDescription(text(rig.description));
  };
  const editNode = (rig: RecordJson, node: RecordJson) => {
    editRig(rig);
    setNodeId(text(node.id));
    setName(text(node.name));
    setHardwareType(text(node.hardware_type) || "custom");
    setRole(text(node.role) || "standalone");
    setHostname(text(node.hostname));
    setAddress(text(node.address));
    setOsName(text(node.os));
    setCpuModel(text(node.cpu_model));
    setMemoryGb(numberText(node.memory_gb));
    setNotes(text(node.notes));
    const accelerator = records({ items: node.accelerators ?? [] }, "items")[0];
    setAcceleratorName(text(accelerator?.name));
    setAcceleratorCount(numberText(accelerator?.count, "1"));
    setAcceleratorMemory(numberText(accelerator?.memory_gb));
    setAcceleratorType(text(accelerator?.memory_type));
    setAcceleratorBandwidth(numberText(accelerator?.memory_bandwidth_gbs));
    setUnifiedMemory(accelerator?.unified_memory === true);
  };
  const nodeBody = (): RecordJson => ({
    name,
    hardware_type: hardwareType,
    role,
    hostname: hostname || null,
    address: address || null,
    os: osName || null,
    cpu_model: cpuModel || null,
    memory_gb: Number(memoryGb) || null,
    notes: notes || null,
    accelerators: acceleratorName
      ? [
          {
            name: acceleratorName,
            count: Number(acceleratorCount) || 1,
            memory_gb: Number(acceleratorMemory) || null,
            memory_type: acceleratorType || null,
            memory_bandwidth_gbs: Number(acceleratorBandwidth) || null,
            unified_memory: unifiedMemory,
          },
        ]
      : [],
  });
  return (
    <article>
      <h2>Rigs, nodes, runtimes & providers</h2>
      <div className="row">
        <input
          value={rigId}
          onChange={(event) => setRigId(event.target.value)}
          placeholder="Rig id"
        />
        <input value={name} onChange={(event) => setName(event.target.value)} placeholder="Name" />
        <input
          value={description}
          onChange={(event) => setDescription(event.target.value)}
          placeholder="Description"
        />
        <button
          onClick={() =>
            run(
              rigId
                ? `/api/proxy/studio/rigs/${encodeURIComponent(rigId)}`
                : "/api/proxy/studio/rigs",
              jsonBody({ name, description: description || null }, rigId ? "PUT" : "POST"),
            )
          }
        >
          Save rig
        </button>
        <button
          disabled={!rigId}
          onClick={() =>
            run(`/api/proxy/studio/rigs/${encodeURIComponent(rigId)}`, { method: "DELETE" })
          }
        >
          Delete rig
        </button>
      </div>
      <div className="row">
        <input
          value={nodeId}
          onChange={(event) => setNodeId(event.target.value)}
          placeholder="Node id"
        />
        <select value={hardwareType} onChange={(event) => setHardwareType(event.target.value)}>
          {(
            [
              "dgx-spark",
              "gpu-desktop",
              "gpu-server",
              "mac",
              "laptop",
              "mini-pc",
              "custom",
            ] as const
          ).map((value) => (
            <option key={value}>{value}</option>
          ))}
        </select>
        <select value={role} onChange={(event) => setRole(event.target.value)}>
          {(["head", "worker", "standalone"] as const).map((value) => (
            <option key={value}>{value}</option>
          ))}
        </select>
        {[
          { value: hostname, set: setHostname, label: "Hostname" },
          { value: address, set: setAddress, label: "Address" },
          { value: osName, set: setOsName, label: "OS" },
          { value: cpuModel, set: setCpuModel, label: "CPU model" },
          { value: memoryGb, set: setMemoryGb, label: "Memory GB" },
          { value: notes, set: setNotes, label: "Notes" },
          { value: acceleratorName, set: setAcceleratorName, label: "Accelerator" },
          { value: acceleratorCount, set: setAcceleratorCount, label: "Accelerator count" },
          { value: acceleratorMemory, set: setAcceleratorMemory, label: "Accelerator memory GB" },
          { value: acceleratorType, set: setAcceleratorType, label: "Memory type" },
          { value: acceleratorBandwidth, set: setAcceleratorBandwidth, label: "Bandwidth GB/s" },
        ].map((field) => (
          <input
            key={field.label}
            value={field.value}
            onChange={(event) => field.set(event.target.value)}
            placeholder={field.label}
          />
        ))}
        <label>
          <input
            type="checkbox"
            checked={unifiedMemory}
            onChange={(event) => setUnifiedMemory(event.target.checked)}
          />{" "}
          Unified memory
        </label>
        <button
          disabled={!rigId}
          onClick={() =>
            run(
              nodeId
                ? `/api/proxy/studio/rigs/${encodeURIComponent(rigId)}/nodes/${encodeURIComponent(nodeId)}`
                : `/api/proxy/studio/rigs/${encodeURIComponent(rigId)}/nodes`,
              jsonBody(nodeBody(), nodeId ? "PUT" : "POST"),
            )
          }
        >
          Save node
        </button>
        <button
          disabled={!rigId || !nodeId}
          onClick={() =>
            run(
              `/api/proxy/studio/rigs/${encodeURIComponent(rigId)}/nodes/${encodeURIComponent(nodeId)}`,
              { method: "DELETE" },
            )
          }
        >
          Delete node
        </button>
      </div>
      {records(rigs.data, "rigs").map((rig) => (
        <div className="item" key={text(rig.id)}>
          <button onClick={() => editRig(rig)}>Edit {text(rig.name)}</button>
          {records({ items: rig.nodes ?? [] }, "items").map((node) => (
            <button key={text(node.id)} onClick={() => editNode(rig, node)}>
              Edit {text(node.name)}
            </button>
          ))}
        </div>
      ))}
      {records(targets.data, "targets").map((target) => {
        const targetId = text(target.id);
        return (
          <div className="item" key={targetId}>
            <span>{text(target.name) || targetId}</span>
            <button
              onClick={() =>
                run(`/api/proxy/runtime/targets/${encodeURIComponent(targetId)}/select`, {
                  method: "POST",
                })
              }
            >
              Select runtime
            </button>
          </div>
        );
      })}
      <p>
        Provider accounts use explicit sign-in and sign-out in Integrations. Secrets stay local.
      </p>
      <ErrorText value={message || rigs.error || targets.error || providers.error} />
      <JsonView value={providers.data} />
    </article>
  );
}

function redactDeployLine(line: string): string {
  return line
    .replace(
      /((?:api[_ -]?key|token|secret|password|authorization)["']?\s*[:=]\s*(?:bearer\s+)?["']?)[^"'\s]+/gi,
      "$1[stored]",
    )
    .replace(/(https?:\/\/)[^@\s]+@/gi, "$1[credentials-stored]@");
}

export function DesktopManager() {
  const bridge = globalThis.window?.localStudioDesktop;
  const [path, setPath] = useState("");
  const [projectId, setProjectId] = useState("");
  const [deployHost, setDeployHost] = useState("");
  const [hotkey, setHotkey] = useState("");
  const [output, setOutput] = useState<Json | null>(null);
  const [deployLog, setDeployLog] = useState<string[]>([]);
  const [terminalId, setTerminalId] = useState("");
  const [terminalInput, setTerminalInput] = useState("");
  const [terminalOutput, setTerminalOutput] = useState("");
  const [error, setError] = useState("");
  useMountSubscription(
    () =>
      bridge?.controllerDeploy.onLog((line) =>
        setDeployLog((lines) => [...lines, redactDeployLine(line)]),
      ),
    [bridge],
  );
  useMountSubscription(() => {
    if (!bridge) return;
    const stopData = bridge.terminal.onData((id, chunk) => {
      if (id === terminalId) setTerminalOutput((value) => value + chunk);
    });
    const stopExit = bridge.terminal.onExit((id, info) => {
      if (id === terminalId) {
        setTerminalOutput((value) => `${value}\n[exit ${info.exitCode}]`);
        setTerminalId("");
      }
    });
    return () => {
      stopData();
      stopExit();
    };
  }, [bridge, terminalId]);
  const call = async (operation: () => Promise<object | string | number | boolean | null>) => {
    try {
      setOutput(JSON.stringify(await operation()));
      setError("");
    } catch (value) {
      setError(value instanceof Error ? value.message : String(value));
    }
  };
  const copyPairingCredential = async () => {
    if (!bridge) return;
    await call(async () => {
      const result = await bridge.getKittylitterPairingJson();
      if (!result.ok || !result.pairingJson)
        return { ok: false, error: result.error ?? "Pairing credential unavailable" };
      const copied = await bridge.copyKittylitterPairingJson(result.pairingJson);
      return { ok: copied.ok, credentialCopied: copied.ok, error: copied.error ?? null };
    });
  };
  const deploy = async () => {
    if (!bridge || !deployHost.trim()) return;
    setDeployLog([]);
    await call(async () => {
      const result = await bridge.controllerDeploy.start({ host: deployHost });
      if (!result.ok) return { ok: false, error: result.error ?? "Deployment failed" };
      if (!result.url || !result.apiKey)
        return { ok: false, error: "Deployment omitted credentials" };
      await request("/api/settings", jsonBody({ backendUrl: result.url, apiKey: result.apiKey }));
      return { ok: true, url: result.url, credentialStored: true };
    });
  };
  const openTerminal = async () => {
    if (!bridge) return;
    await call(async () => {
      const result = await bridge.terminal.open({ cwd: path || undefined, cols: 100, rows: 28 });
      setTerminalId(result.id);
      setTerminalOutput(result.replay ?? "");
      return { id: result.id, reused: result.reused ?? false };
    });
  };
  const closeTerminal = async () => {
    if (!bridge || !terminalId) return;
    await call(async () => {
      await bridge.terminal.close(terminalId);
      setTerminalId("");
      return true;
    });
  };
  if (!bridge)
    return (
      <article>
        <h2>Desktop bridge</h2>
        <p>
          Desktop-only project, preference, update, quick panel, open, and reveal controls appear in
          the packaged app.
        </p>
      </article>
    );
  return (
    <article>
      <h2>Desktop bridge</h2>
      <div className="row">
        <button onClick={() => call(() => bridge.openDirectory())}>Add project folder</button>
        <button onClick={() => call(() => bridge.listProjects())}>List projects</button>
        <input
          value={projectId}
          onChange={(event) => setProjectId(event.target.value)}
          placeholder="Project id"
        />
        <button onClick={() => call(() => bridge.removeProject(projectId))}>Remove project</button>
        <input
          value={path}
          onChange={(event) => setPath(event.target.value)}
          placeholder="Local path"
        />
        <button onClick={() => call(() => bridge.openPath(path))}>Open</button>
        <button onClick={() => call(() => bridge.revealPath(path))}>Reveal</button>
      </div>
      <div className="row">
        <button onClick={() => call(() => bridge.getRuntime())}>Desktop runtime</button>
        <button onClick={() => call(() => bridge.terminal.status())}>Terminal status</button>
        <button onClick={openTerminal}>
          {terminalId ? "Reconnect terminal" : "Open terminal"}
        </button>
        <input
          value={terminalInput}
          onChange={(event) => setTerminalInput(event.target.value)}
          placeholder="Terminal input"
        />
        <button
          disabled={!terminalId}
          onClick={() =>
            call(async () => {
              await bridge.terminal.write(terminalId, `${terminalInput}\n`);
              setTerminalInput("");
              return true;
            })
          }
        >
          Write terminal
        </button>
        <button
          disabled={!terminalId}
          onClick={() => call(() => bridge.terminal.resize(terminalId, 120, 36).then(() => true))}
        >
          Resize terminal
        </button>
        <button disabled={!terminalId} onClick={closeTerminal}>
          Close terminal
        </button>
        <button onClick={() => call(() => bridge.loadUiPreferences())}>Load preferences</button>
        <button
          onClick={() =>
            call(() =>
              bridge
                .saveUiPreferences({ theme: document.documentElement.dataset.theme ?? "dark" })
                .then(() => true),
            )
          }
        >
          Save preferences
        </button>
        <button onClick={() => call(() => bridge.getUpdateStatus())}>Check updates</button>
        <button onClick={() => call(() => bridge.startUpdate())}>Install update</button>
      </div>
      <div className="row">
        <input
          value={hotkey}
          onChange={(event) => setHotkey(event.target.value)}
          placeholder="Quick panel hotkey"
        />
        <button onClick={() => call(() => bridge.quickPanel.getHotkey())}>Get hotkey</button>
        <button onClick={() => call(() => bridge.quickPanel.setHotkey(hotkey))}>Set hotkey</button>
        <button onClick={() => call(() => bridge.quickPanel.expand().then(() => true))}>
          Open quick panel
        </button>
        <button onClick={() => call(() => bridge.quickPanel.dismiss().then(() => true))}>
          Dismiss quick panel
        </button>
        <button onClick={copyPairingCredential}>Copy KittyLitter pairing credential</button>
        <button
          onClick={() =>
            call(() => bridge.quickPanel.focusMainAndNavigate(projectId).then(() => true))
          }
        >
          Open project in main window
        </button>
      </div>
      <div className="row">
        <input
          value={deployHost}
          onChange={(event) => setDeployHost(event.target.value)}
          placeholder="SSH host for controller"
        />
        <button onClick={deploy}>Deploy controller and store credential</button>
      </div>
      {terminalOutput ? <pre aria-label="Desktop terminal output">{terminalOutput}</pre> : null}
      {deployLog.length ? (
        <pre aria-label="Controller deployment log">{deployLog.join("\n")}</pre>
      ) : null}
      <ErrorText value={error} />
      {output === null ? null : <JsonView value={output} />}
    </article>
  );
}

export function NormalizedUsage({ value }: { value: Json | null }) {
  const [view, setView] = useState<"models" | "activity" | "controller" | "errors">("models");
  const root = records([value], "value")[0] ?? {};
  const controller = records([root.controller ?? null], "value")[0] ?? {};
  const rows =
    view === "models"
      ? records(root, "by_model")
      : view === "activity"
        ? records(root, "daily")
        : view === "controller"
          ? records(controller, "by_path")
          : records(controller, "recent_errors");
  return (
    <article>
      <div className="tabs">
        {(["models", "activity", "controller", "errors"] as const).map((name) => (
          <button key={name} onClick={() => setView(name)}>
            {name}
          </button>
        ))}
      </div>
      <p>
        Normalized {view} view · {rows.length} rows · controller metrics included
      </p>
      <JsonView
        value={view === "controller" ? (controller.totals ?? null) : (root.totals ?? null)}
      />
      <JsonView value={rows} />
    </article>
  );
}
