# Running Qwen3.6-27B on the B70s

Deep-research-backed guide for serving **Qwen3.6-27B (INT4)** across the two
Intel Arc Pro B70s with `intel/llm-scaler-vllm`, TP=2, XPU backend. Pairs with
[`B70-RECOVERY-GUIDE.md`](./B70-RECOVERY-GUIDE.md) (keep the GPUs alive) and the
launcher [`run-qwen36.sh`](./run-qwen36.sh).

> Verified on the box 2026-06-07: model + image are already present.

## What's on the host

| Item | Value |
| --- | --- |
| Model (INT4) | `/mnt/llm_models/Qwen3.6-27B-int4-GPTQ-compat` (18 GB) |
| Alt INT4 | `/mnt/llm_models/Qwen3.6-27B-int4-AutoRound` (18 GB) |
| Alt INT8 | `/mnt/llm_models/Qwen3.6-27B-INT8-AutoRound` (35 GB) |
| BF16 | `/mnt/llm_models/Qwen3.6-27B` |
| Image | `intel/llm-scaler-vllm:0.14.0-b8.3.1` (and `b70-vllm-qwen36:latest`) |
| GPUs | 2× B70 → renderD132 (`83:00.0`), renderD133 (`c4:00.0`), capped 150 W |

## Model facts that drive the config

- **Architecture:** `Qwen3_5ForConditionalGeneration` / `model_type: qwen3_5` —
  a **dense hybrid**: 64 layers = 48 Gated-DeltaNet (GDN, linear-attention)
  layers + 16 full-attention layers. Only the 16 full-attn layers hold a normal
  KV cache; GDN layers carry a small recurrent (Mamba-style) state → **long
  context is cheap on KV memory**.
- **Quant:** AutoRound INT4, `packing_format: auto_round:auto_gptq`, `sym: true`,
  `group_size: -1`. vLLM **auto-detects this as GPTQ** — do **not** pass
  `--quantization`. The recipe correctly keeps the **GDN `in_proj` and the MTP
  layers at 16-bit**, which is why this checkpoint is the right one to use.
- **Vision:** yes (image+video). Use `--language-model-only` for text-only to
  free memory; the launcher does this by default (`B70_VISION=1` to enable).
- **Context:** 262,144 native (we default `--max-model-len 32768`; raise as KV
  budget allows — GDN keeps KV small so 64k+ is realistic on 2×32 GB).
- **MTP:** the checkpoint ships an MTP head, **but leave it OFF** — see below.

## Quick start

```bash
# on the GPU host, from this dir
./run-qwen36.sh            # preflight-gated launch (text-only, TP=2, INT4)
./run-qwen36.sh --logs     # follow startup
curl -s localhost:8010/v1/models | jq .
```

Override anything via env, e.g. longer context or vision:

```bash
B70_MAX_LEN=65536 ./run-qwen36.sh
B70_VISION=1 ./run-qwen36.sh
B70_MODEL_DIR=/mnt/llm_models/Qwen3.6-27B-INT8-AutoRound ./run-qwen36.sh
```

## The exact serve config and *why*

```text
--tensor-parallel-size 2        # shard across both B70s
--dtype float16                 # XPU path (engine casts bf16->fp16 anyway)
--enforce-eager                 # XPU has no CUDA-graph/torch.compile; required
(no --quantization)             # AutoRound int4 auto-detected as GPTQ
--block-size 64                 # hybrid model may auto-override; harmless
--gpu-memory-util 0.90
--max-model-len 32768
--max-num-batched-tokens 8192   # chunked prefill
--no-enable-prefix-caching      # prefix cache is experimental on GDN layers
--reasoning-parser qwen3        # thinking model
--enable-auto-tool-choice --tool-call-parser qwen3_xml   # qwen3_xml > qwen3_coder for robustness
--language-model-only           # text-only by default (drop for vision)
```

Key env (set by the launcher):

| Env | Why |
| --- | --- |
| `source /opt/intel/oneapi/setvars.sh --force` | wrong `LD_LIBRARY_PATH` otherwise → OOM/slow (KNOWN_ISSUES #03) |
| `VLLM_WORKER_MULTIPROC_METHOD=spawn` | one worker per GPU for TP=2 |
| `VLLM_OFFLOAD_WEIGHTS_BEFORE_QUANT=1` | avoid OOM on weight load/quant |
| `PYTORCH_ALLOC_CONF=expandable_segments:True` | reduce XPU fragmentation OOM |
| `CCL_ZE_IPC_EXCHANGE=sockets` | oneCCL IPC handle exchange across GPUs |
| `CCL_TOPO_P2P_ACCESS=1` | P2P mode (~15% faster at large batch; set 0 = USM fallback) |
| `TORCH_LLM_ALLREDUCE=1` | torch allreduce path used in Intel multi-GPU examples |
| `ZES_ENABLE_SYSMAN=1` | Level-Zero sysman device/mem mgmt |

## MTP stays OFF (important)

Do **not** add `--speculative-config`. Two independent, well-documented reasons:

1. **TP=2 + MTP on hybrid-GDN Qwen3.x crashes on the first request** with
   `cudaErrorIllegalAddress` (vLLM #41190), and there is **no merged fix**. We
   run TP=2, so this alone rules it out.
2. The speculative path through the **GDN/linear-attention** layers is the
   source of repeated illegal-memory-access bugs, and on **non-CUDA backends
   (XPU) the spec kernels are not validated at all**. No working B70 config in
   Intel's tracker uses speculative decoding (`speculative_config=None`
   everywhere).

So MTP is a stability hazard on this exact stack (XPU + TP=2 + GDN). Leave it off.

## Expected performance (set expectations)

Field reports for ~27B Qwen INT4 on 2×B70: **~11–12 tok/s decode**, ~2300–2700
tok/s prefill, single-stream. Throughput improves with concurrency. If you see
**<5 tok/s**, the model likely fell back to CPU — check that oneAPI was sourced
and the GPUs are actually busy (`xpu-smi dump` if installed, or watch power draw
via the hwmon path). This is an immaturity of the llm-scaler XPU stack, not your
config.

## Troubleshooting

| Symptom | Fix |
| --- | --- |
| Preflight abort | `sudo /usr/local/sbin/b70-check --fix`; see recovery guide |
| OOM at load/quant | ensure `VLLM_OFFLOAD_WEIGHTS_BEFORE_QUANT=1` + `expandable_segments`; lower `--gpu-memory-util` to 0.8 |
| `gptq_shuffle` / marlin unsupported | this checkpoint is AutoRound/auto-gptq; if it hits the buggy kernel add `--allow-deprecated-quantization` (routes via ipex) |
| Hang at startup | start text-only; try `CCL_TOPO_P2P_ACCESS=0` (USM) to rule out P2P |
| `UR_RESULT_ERROR_DEVICE_LOST` | a card wedged mid-load → watchdog will catch it; re-run after `b70-check` passes |
| <5 tok/s (CPU fallback) | confirm `setvars.sh` sourced; verify GPU busy |
| Tool calling flaky | already using `qwen3_xml`; if still bad, supply a fixed chat template via `--chat-template` |

## Tradeoffs between the three quant variants on disk

- **INT4-GPTQ-compat** (default): smallest (18 GB), most KV headroom, fastest.
  GDN/MTP kept at 16-bit so quality holds. **Recommended.**
- **INT4-AutoRound**: same size; functionally equivalent — try if GPTQ-compat
  hits a kernel path issue.
- **INT8-AutoRound** (35 GB): higher quality, ~17.5 GB/GPU at TP=2, less KV room.
  Use if INT4 quality is insufficient and you don't need huge context.
