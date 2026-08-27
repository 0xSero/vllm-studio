export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export {
  authProxy as GET,
  authProxy as POST,
  authProxy as DELETE,
} from "@/app/api/agent/route-proxy";
