# GLM-5.2 logprob analysis toolkit

Read-only logprob collection and analysis for the GLM-5.2 model served by vLLM
on the inference box. Two scripts, pure-stdlib Python (no dependencies).

## What this does

- `collect.py` runs **on the inference box** and hits vLLM directly at
  `127.0.0.1:8000` (the bun controller on `:8080` is monitored for health only).
  It uses `/v1/completions` with `echo=true, top_logprobs=20` for full
  prompt+completion distributions, and `/v1/chat/completions` with tools for
  tool-call token tracking. Output is JSONL (one record per request).
- `analyze.py` reads the JSONL and writes a doc-style HTML report plus a text
  summary: per-token entropy (top-20 normalized), top-1 probability, surprise,
  chosen-token rank, top-5/10/20 cumulative mass, formatting-bias (first-token
  distribution), refusal edges, tool-call boundaries, sampling stability
  (temperature 0.7 repeats), and a latency/status time series.

## Why API-tier only

All 4 GPUs are pinned at ~95% by the serving process, so a second `vllm.LLM`
load for full-vocab logits (logit-lens / layer attribution) is not feasible
without a maintenance window. Entropy here is therefore a **lower bound** over
the returned top-20, reported normalized by ln 20 so it is comparable across
positions.

## Run

```bash
# on the box, from scripts/logit-analysis/
python3 collect.py --mode both --out-dir ./out \
  --max-tokens 256 --stability-repeats 5 \
  --monitor-interval 30 --monitor-count 20

# then locally
python3 scripts/logit-analysis/analyze.py out/sweep-*.jsonl out/monitor-*.jsonl \
  -o glm52-logprobs.html
```

No auth key is required for the in-box vLLM port (serve was started without
`--api-key`). The public gateway (`api.homelabai.org`) also preserves logprobs
through the bun proxy, but only the in-box port exposes `/v1/completions`+`echo`
for prompt-side logprobs.
