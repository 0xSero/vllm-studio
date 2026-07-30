import type { NextRequest } from "next/server";

export const requestUsesHttps = (request: NextRequest): boolean => {
  const forwardedProtocol = request.headers
    .get("x-forwarded-proto")
    ?.split(",")[0]
    ?.trim()
    .toLowerCase();
  return forwardedProtocol ? forwardedProtocol === "https" : request.nextUrl.protocol === "https:";
};
