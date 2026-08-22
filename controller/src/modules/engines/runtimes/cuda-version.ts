export const extractCudaVersion = (output: string): string | null =>
  output.match(/CUDA (?:UMD )?Version\s*:\s*([0-9.]+)/i)?.[1] ?? null;
