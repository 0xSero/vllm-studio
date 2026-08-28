/**
 * Weights may occupy at most this share of the machine's aggregate memory.
 *
 * The rest of the pool pays for the KV cache, activations, CUDA graphs, and the
 * runtime itself — a checkpoint that exactly equals the pool cannot actually be
 * served. 70% is the headroom every fit verdict on this page is tuned against.
 */
export const FIT_BUDGET_RATIO = 0.7;

export const formatGb = (sizeGb: number): string =>
  sizeGb >= 100 ? `${Math.round(sizeGb)} GB` : `${Math.round(sizeGb * 10) / 10} GB`;
