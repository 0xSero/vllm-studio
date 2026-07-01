import { Counter, Gauge, Registry } from "prom-client";
import type { GpuInfo } from "../models/types";

export interface MetricsRegistry {
  registry: Registry;
  contentType: string;
  getMetrics: () => Promise<string>;
}

export interface ControllerMetrics {
  updateActiveModel: (modelPath?: string | null, backend?: string | null, servedName?: string | null) => void;
  updateGpuMetrics: (gpus: GpuInfo[]) => void;
  updateSseMetrics: (stats: Record<string, unknown>) => void;
}

export const createMetrics = (): { registry: MetricsRegistry; metrics: ControllerMetrics } => {
  const registry = new Registry();

  const activeModelInfo = new Gauge({
    name: "local_studio_active_model",
    help: "Currently active model information",
    labelNames: ["model_path", "backend", "served_model_name"],
    registers: [registry],
  });

  const inferenceServerUp = new Gauge({
    name: "local_studio_inference_server_up",
    help: "Whether inference server is running (1=up, 0=down)",
    registers: [registry],
  });

  const gpuMemoryUsed = new Gauge({
    name: "local_studio_gpu_memory_used_bytes",
    help: "GPU memory used in bytes",
    labelNames: ["gpu_id", "gpu_name"],
    registers: [registry],
  });

  const gpuMemoryTotal = new Gauge({
    name: "local_studio_gpu_memory_total_bytes",
    help: "Total GPU memory in bytes",
    labelNames: ["gpu_id", "gpu_name"],
    registers: [registry],
  });

  const gpuUtilization = new Gauge({
    name: "local_studio_gpu_utilization_percent",
    help: "GPU utilization percentage",
    labelNames: ["gpu_id", "gpu_name"],
    registers: [registry],
  });

  const gpuTemperature = new Gauge({
    name: "local_studio_gpu_temperature_celsius",
    help: "GPU temperature in Celsius",
    labelNames: ["gpu_id", "gpu_name"],
    registers: [registry],
  });

  const sseActiveConnections = new Gauge({
    name: "local_studio_sse_active_connections",
    help: "Number of active SSE connections",
    labelNames: ["channel"],
    registers: [registry],
  });

  const sseEventsPublished = new Counter({
    name: "local_studio_sse_events_published_total",
    help: "Total SSE events published",
    labelNames: ["event_type"],
    registers: [registry],
  });

  let lastEventCount = 0;

  const metrics: ControllerMetrics = {
    updateActiveModel: (modelPath, backend, servedName) => {
      activeModelInfo.reset();
      const labels = {
        model_path: modelPath ?? "",
        backend: backend ?? "",
        served_model_name: servedName ?? "",
      };
      activeModelInfo.labels(labels).set(1);
      inferenceServerUp.set(modelPath ? 1 : 0);
    },
    updateGpuMetrics: (gpus) => {
      for (const gpu of gpus) {
        const labels = { gpu_id: String(gpu.index), gpu_name: gpu.name };
        gpuMemoryUsed.labels(labels).set(gpu.memory_used_mb * 1024 * 1024);
        gpuMemoryTotal.labels(labels).set(gpu.memory_total_mb * 1024 * 1024);
        gpuUtilization.labels(labels).set(gpu.utilization_pct);
        gpuTemperature.labels(labels).set(gpu.temp_c);
      }
    },
    updateSseMetrics: (stats) => {
      const channels = stats["channels"];
      if (channels && typeof channels === "object") {
        for (const [channel, count] of Object.entries(channels)) {
          sseActiveConnections.labels({ channel }).set(Number(count));
        }
      }
      const totalEvents = Number(stats["total_events_published"] ?? 0);
      if (totalEvents > lastEventCount) {
        sseEventsPublished.labels({ event_type: "all" }).inc(totalEvents - lastEventCount);
        lastEventCount = totalEvents;
      } else if (totalEvents < lastEventCount) {
        lastEventCount = totalEvents;
      }
    },
  };

  const metricsRegistry: MetricsRegistry = {
    registry,
    contentType: registry.contentType,
    getMetrics: async () => registry.metrics(),
  };

  return { registry: metricsRegistry, metrics };
};
