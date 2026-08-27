const MAX_DIMENSION = 2048;
const MAX_SOURCE_BYTES = 50 * 1024 * 1024;
const MAX_HEIC_PIXELS = 64_000_000;
const HEIC_METADATA_BYTES = 1024 * 1024;
const QUALITY_STEPS = [0.92, 0.85, 0.78, 0.68] as const;
const SCALE_STEPS = [1, 0.75, 0.55] as const;
const HEIC_TYPE = /^image\/hei(?:c|f)$/i;
const HEIC_NAME = /\.(?:heic|heif)$/i;

export type ImagePreparationResult =
  | { ok: true; file: File; recompressed: boolean }
  | { ok: false; reason: "too-large" | "unreadable" };

export function isHeicImage(file: Pick<File, "name" | "type">): boolean {
  return (
    HEIC_TYPE.test(file.type) ||
    ((file.type === "" || file.type === "application/octet-stream") && HEIC_NAME.test(file.name))
  );
}

function fileNameForType(name: string, type: string): string {
  const extension = type === "image/webp" ? ".webp" : ".jpg";
  const dot = name.lastIndexOf(".");
  return `${dot > 0 ? name.slice(0, dot) : name || "image"}${extension}`;
}

function canvasFor(width: number, height: number) {
  if (typeof OffscreenCanvas === "function") {
    const canvas = new OffscreenCanvas(width, height);
    const context = canvas.getContext("2d");
    return context ? { canvas, context } : null;
  }
  if (typeof document === "undefined") return null;
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext("2d");
  return context ? { canvas, context } : null;
}

async function canvasBlob(
  canvas: OffscreenCanvas | HTMLCanvasElement,
  type: string,
  quality: number,
): Promise<Blob | null> {
  if (typeof OffscreenCanvas === "function" && canvas instanceof OffscreenCanvas) {
    try {
      const blob = await canvas.convertToBlob({ type, quality });
      return blob.type === type ? blob : null;
    } catch {
      return null;
    }
  }
  return new Promise((resolve) => {
    (canvas as HTMLCanvasElement).toBlob(
      (blob) => resolve(blob?.type === type ? blob : null),
      type,
      quality,
    );
  });
}

async function encodeBitmap(
  bitmap: ImageBitmap,
  maxBytes: number,
  type: "image/webp" | "image/jpeg",
): Promise<Blob | null> {
  const sourceDimension = Math.max(bitmap.width, bitmap.height);
  for (const scaleStep of SCALE_STEPS) {
    const targetDimension = Math.max(
      1,
      Math.round(Math.min(MAX_DIMENSION, sourceDimension) * scaleStep),
    );
    const scale = Math.min(1, targetDimension / sourceDimension);
    const width = Math.max(1, Math.round(bitmap.width * scale));
    const height = Math.max(1, Math.round(bitmap.height * scale));
    const target = canvasFor(width, height);
    if (!target) return null;
    if (type === "image/jpeg") {
      target.context.fillStyle = "#ffffff";
      target.context.fillRect(0, 0, width, height);
    }
    target.context.drawImage(bitmap, 0, 0, width, height);
    for (const quality of QUALITY_STEPS) {
      const blob = await canvasBlob(target.canvas, type, quality);
      if (blob && blob.size <= maxBytes) return blob;
    }
  }
  return null;
}

async function compressFile(
  file: File,
  maxBytes: number,
  preferredType?: "image/jpeg",
): Promise<ImagePreparationResult> {
  if (file.size <= maxBytes && !preferredType) {
    return { ok: true, file, recompressed: false };
  }
  if (file.size > MAX_SOURCE_BYTES || typeof createImageBitmap !== "function") {
    return { ok: false, reason: "too-large" };
  }
  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(file);
  } catch {
    return { ok: false, reason: "unreadable" };
  }
  try {
    const types = preferredType
      ? ([preferredType] as const)
      : (["image/webp", "image/jpeg"] as const);
    for (const type of types) {
      const blob = await encodeBitmap(bitmap, maxBytes, type);
      if (!blob) continue;
      return {
        ok: true,
        file: new File([blob], fileNameForType(file.name, type), {
          type,
          lastModified: file.lastModified,
        }),
        recompressed: true,
      };
    }
    return { ok: false, reason: "too-large" };
  } finally {
    bitmap.close();
  }
}

type Box = { payload: number; end: number };

function findBox(view: DataView, start: number, end: number, type: number): Box | null {
  let offset = start;
  while (offset + 8 <= end) {
    let size = view.getUint32(offset);
    let header = 8;
    if (size === 1) {
      if (offset + 16 > end) return null;
      const extended = view.getBigUint64(offset + 8);
      if (extended > BigInt(Number.MAX_SAFE_INTEGER)) return null;
      size = Number(extended);
      header = 16;
    } else if (size === 0) {
      size = end - offset;
    }
    if (size < header || size > end - offset) return null;
    const next = offset + size;
    if (view.getUint32(offset + 4) === type) return { payload: offset + header, end: next };
    offset = next;
  }
  return null;
}

async function validHeicDimensions(file: File): Promise<boolean> {
  try {
    const view = new DataView(await file.slice(0, HEIC_METADATA_BYTES).arrayBuffer());
    const meta = findBox(view, 0, view.byteLength, 0x6d657461);
    if (!meta || meta.payload + 4 > meta.end) return false;
    const properties = findBox(view, meta.payload + 4, meta.end, 0x69707270);
    if (!properties) return false;
    const container = findBox(view, properties.payload, properties.end, 0x6970636f);
    if (!container) return false;
    let offset = container.payload;
    let found = false;
    while (offset < container.end) {
      const dimensions = findBox(view, offset, container.end, 0x69737065);
      if (!dimensions) break;
      if (dimensions.payload + 12 > dimensions.end) return false;
      const width = view.getUint32(dimensions.payload + 4);
      const height = view.getUint32(dimensions.payload + 8);
      if (!width || !height || width > MAX_HEIC_PIXELS / height) return false;
      found = true;
      offset = dimensions.end;
    }
    return found;
  } catch {
    return false;
  }
}

export async function prepareImageForAttachment(
  file: File,
  maxBytes: number,
): Promise<ImagePreparationResult> {
  if (!isHeicImage(file)) return compressFile(file, maxBytes);
  if (file.size > MAX_SOURCE_BYTES || !(await validHeicDimensions(file))) {
    return { ok: false, reason: "too-large" };
  }
  try {
    const { heicTo } = await import("heic-to/csp");
    const converted = await heicTo({ blob: file, type: "image/jpeg", quality: QUALITY_STEPS[0] });
    const jpeg = new File([converted], fileNameForType(file.name, "image/jpeg"), {
      type: "image/jpeg",
      lastModified: file.lastModified,
    });
    const compressed = await compressFile(jpeg, maxBytes, "image/jpeg");
    return compressed.ok ? { ...compressed, recompressed: true } : compressed;
  } catch {
    return { ok: false, reason: "unreadable" };
  }
}
