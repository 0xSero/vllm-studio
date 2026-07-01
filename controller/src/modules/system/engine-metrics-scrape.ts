import { fetchLocal } from "../../http/local-fetch";

export type EngineScrape = {
  status: number;
  metrics: Record<string, number>;
  modelName: string | null;
  hasVllm: boolean;
  hasSglang: boolean;
};

export const scrapeEngineMetrics = async (
  port: number,
  timeoutMs: number
): Promise<EngineScrape> => {
  const scrape: EngineScrape = {
    status: 0,
    metrics: {},
    modelName: null,
    hasVllm: false,
    hasSglang: false,
  };
  try {
    const response = await fetchLocal(port, "/metrics", { timeoutMs });
    scrape.status = response.status;
    if (response.status !== 200) return scrape;
    const text = await response.text();
    for (const line of text.split("\n")) {
      if (line.startsWith("#") || line.trim().length === 0) continue;
      if (!scrape.hasVllm && line.startsWith("vllm:")) scrape.hasVllm = true;
      if (!scrape.hasSglang && line.startsWith("sglang:")) scrape.hasSglang = true;
      if (!scrape.modelName) {
        const label = line.match(/(?:served_model_name|model_name)="([^"]+)"/);
        if (label?.[1]) scrape.modelName = label[1];
      }
      const match = line.match(/^([a-zA-Z_:][a-zA-Z0-9_:]*)\{?[^}]*\}?\s+([\d.eE+-]+)$/);
      if (!match?.[1] || !match[2]) continue;
      const value = Number(match[2]);
      if (Number.isFinite(value)) scrape.metrics[match[1]] = value;
    }
    return scrape;
  } catch {
    return scrape;
  }
};

export type EngineMetricNames = {
  promptTokens: string[];
  generationTokens: string[];
  promptThroughput: string[];
  generationThroughput: string[];
  runningRequests: string[];
  pendingRequests: string[];
  kvCacheUsage: string[];
  ttftSum: string;
  ttftCount: string;
};

export const VLLM_METRIC_NAMES: EngineMetricNames = {
  promptTokens: ["vllm:prompt_tokens_total"],
  generationTokens: ["vllm:generation_tokens_total"],
  promptThroughput: ["vllm:prompt_throughput", "vllm:prefill_throughput"],
  generationThroughput: ["vllm:gen_throughput", "vllm:generation_throughput"],
  runningRequests: ["vllm:num_requests_running"],
  pendingRequests: ["vllm:num_requests_waiting"],
  kvCacheUsage: ["vllm:kv_cache_usage_perc"],
  ttftSum: "vllm:time_to_first_token_seconds_sum",
  ttftCount: "vllm:time_to_first_token_seconds_count",
};

export const SGLANG_METRIC_NAMES: EngineMetricNames = {
  promptTokens: ["sglang:prompt_tokens_total", "sglang:prefill_tokens_total"],
  generationTokens: [
    "sglang:generation_tokens_total",
    "sglang:completion_tokens_total",
    "sglang:gen_tokens_total",
  ],
  promptThroughput: ["sglang:prompt_throughput", "sglang:prefill_throughput"],
  generationThroughput: ["sglang:gen_throughput", "sglang:generation_throughput"],
  runningRequests: ["sglang:num_running_reqs", "sglang:num_requests_running"],
  pendingRequests: [
    "sglang:num_queue_reqs",
    "sglang:num_pending_reqs",
    "sglang:num_requests_waiting",
  ],
  kvCacheUsage: ["sglang:token_usage", "sglang:kv_cache_usage_perc"],
  ttftSum: "sglang:time_to_first_token_seconds_sum",
  ttftCount: "sglang:time_to_first_token_seconds_count",
};
