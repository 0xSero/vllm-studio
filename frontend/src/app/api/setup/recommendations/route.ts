import { NextResponse, type NextRequest } from "next/server";
import {
  recommendationsForRig,
  requiredPoolGb,
  bundledModelRecommendationsSource,
  type RigDescriptor,
} from "@shared/model-recommendations";

const FILE = bundledModelRecommendationsSource;

export interface SetupRecommendationRow {
  hfId: string;
  name: string;
  quant: string;
  filesize: string;
  requiredGb: number;
  decodeTps: number | null;
  engine: string | null;
  measuredOnThisClass: boolean;
}

export function GET(request: NextRequest): NextResponse {
  const parameters = request.nextUrl.searchParams;
  const rig: RigDescriptor = {
    memoryPoolGb: Number(parameters.get("poolGb") ?? 0),
    gpuCount: Number(parameters.get("gpuCount") ?? 0),
    unifiedMemory: parameters.get("unified") === "1",
    appleSilicon: parameters.get("apple") === "1",
  };
  const limit = Math.min(Number(parameters.get("limit") ?? 6), 20);
  if (!Number.isFinite(rig.memoryPoolGb) || rig.memoryPoolGb <= 0) {
    return NextResponse.json({ updated: FILE.updated, picks: [] });
  }
  const picks: SetupRecommendationRow[] = recommendationsForRig(FILE, rig)
    .slice(0, limit)
    .map((pick) => {
      const tested = pick.hardware.filter((target) => target.tested);
      const closest = [...tested].sort(
        (a, b) =>
          Math.abs(a.minMemoryGb - rig.memoryPoolGb) - Math.abs(b.minMemoryGb - rig.memoryPoolGb),
      )[0];
      const row = closest
        ? pick.benchmarks.find((benchmark) => benchmark.hardwareId === closest.id)
        : pick.benchmarks[0];
      return {
        hfId: pick.hfId,
        name: pick.name,
        quant: pick.quant,
        filesize: pick.filesize,
        requiredGb: requiredPoolGb(pick),
        decodeTps: row?.decodeTps ?? null,
        engine: row?.engine ?? null,
        measuredOnThisClass: pick.measuredOnThisClass,
      };
    });
  return NextResponse.json({ updated: FILE.updated, picks });
}
