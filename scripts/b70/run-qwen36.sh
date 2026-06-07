#!/usr/bin/env bash
#
# run-qwen36.sh — launch Qwen3.6-27B (INT4) on the two Intel Arc Pro B70s, TP=2.
#
# Safety: refuses to start unless both B70s pass the preflight gate
# (present + bound to xe + render node + 150W cap). See B70-RECOVERY-GUIDE.md.
#
# Usage (on the GPU host):
#   ./run-qwen36.sh                 # start the container + server
#   ./run-qwen36.sh --logs          # follow logs of a running server
#   ./run-qwen36.sh --stop          # stop + remove the container
#
# Verified facts (from the box, 2026-06-07):
#   model:  /mnt/llm_models/Qwen3.6-27B-int4-GPTQ-compat
#           arch=Qwen3_5ForConditionalGeneration  model_type=qwen3_5
#           AutoRound INT4 (packing_format auto_round:auto_gptq) -> auto-detected
#           GDN linear_attn in_proj + MTP layers kept at 16-bit (correct recipe)
#           vision=true, native context 262144
#   image:  intel/llm-scaler-vllm:0.14.0-b8.3.1  (also: b70-vllm-qwen36:latest)
#   GPUs:   2x B70 -> renderD132 (83:00.0), renderD133 (c4:00.0)

set -euo pipefail

# --- config (override via env) ----------------------------------------------
IMAGE="${B70_IMAGE:-intel/llm-scaler-vllm:0.14.0-b8.3.1}"
MODEL_DIR="${B70_MODEL_DIR:-/mnt/llm_models/Qwen3.6-27B-int4-GPTQ-compat}"
SERVED_NAME="${B70_SERVED_NAME:-qwen3.6-27b}"
PORT="${B70_PORT:-8010}"
CONTAINER="${B70_CONTAINER:-b70-qwen36}"
MAX_LEN="${B70_MAX_LEN:-32768}"
GPU_UTIL="${B70_GPU_UTIL:-0.90}"
CHECK="/usr/local/sbin/b70-check"

# Text-only by default (skips the vision tower, frees KV cache). Set
# B70_VISION=1 to enable image/video input.
VISION="${B70_VISION:-0}"

# --- subcommands ------------------------------------------------------------
case "${1:-start}" in
  --logs) exec sudo docker logs -f "$CONTAINER" ;;
  --stop) sudo docker rm -f "$CONTAINER" 2>/dev/null || true; echo "stopped $CONTAINER"; exit 0 ;;
  start|"") : ;;
  *) echo "usage: $0 [start|--logs|--stop]"; exit 2 ;;
esac

# --- preflight gate (hard safety interlock) ---------------------------------
if [ -x "$CHECK" ]; then
  echo ">> preflight: B70 health"
  if ! sudo "$CHECK"; then
    echo "ABORT: B70 preflight failed. Fix driver binding first (see B70-RECOVERY-GUIDE.md)." >&2
    echo "Try: sudo $CHECK --fix" >&2
    exit 1
  fi
else
  echo "WARN: $CHECK not installed; skipping safety gate" >&2
fi

# --- clean any stale container ----------------------------------------------
sudo docker rm -f "$CONTAINER" 2>/dev/null || true

# --- vision flags -----------------------------------------------------------
VISION_ARGS="--language-model-only"
if [ "$VISION" = "1" ]; then
  VISION_ARGS="--allowed-local-media-path /llm/models --limit-mm-per-prompt image=4,video=1"
fi

echo ">> launching $CONTAINER ($IMAGE)"
echo "   model=$MODEL_DIR  TP=2  port=$PORT  max_len=$MAX_LEN  vision=$VISION"

# Mount the parent models dir so the in-container path matches the host layout.
sudo docker run -d \
  --privileged \
  --net=host \
  --ipc=host \
  --device=/dev/dri \
  -v /dev/dri/by-path:/dev/dri/by-path \
  -v /mnt/llm_models:/llm/models \
  --shm-size=32g \
  --name "$CONTAINER" \
  --restart no \
  -e ZES_ENABLE_SYSMAN=1 \
  -e VLLM_WORKER_MULTIPROC_METHOD=spawn \
  -e VLLM_ALLOW_LONG_MAX_MODEL_LEN=1 \
  -e VLLM_OFFLOAD_WEIGHTS_BEFORE_QUANT=1 \
  -e PYTORCH_ALLOC_CONF=expandable_segments:True \
  -e CCL_ZE_IPC_EXCHANGE=sockets \
  -e CCL_TOPO_P2P_ACCESS=1 \
  -e TORCH_LLM_ALLREDUCE=1 \
  -e OMP_NUM_THREADS=8 \
  --entrypoint /bin/bash \
  "$IMAGE" \
  -lc "source /opt/intel/oneapi/setvars.sh --force && \
       exec vllm serve /llm/models/$(basename "$MODEL_DIR") \
         --served-model-name $SERVED_NAME \
         --dtype float16 \
         --enforce-eager \
         --trust-remote-code \
         --host 0.0.0.0 --port $PORT \
         --tensor-parallel-size 2 \
         --gpu-memory-util $GPU_UTIL \
         --max-model-len $MAX_LEN \
         --max-num-batched-tokens 8192 \
         --block-size 64 \
         --no-enable-prefix-caching \
         --disable-sliding-window \
         --reasoning-parser qwen3 \
         --enable-auto-tool-choice --tool-call-parser qwen3_xml \
         $VISION_ARGS \
         --disable-log-requests \
         2>&1 | tee /llm/vllm.log"

echo ">> started. Follow logs:  $0 --logs"
echo ">> when ready:  curl -s localhost:$PORT/v1/models | jq ."
