"use client";

import { useRouter } from "next/navigation";
import { useMountSubscription } from "@/hooks/use-mount-subscription";

export default function ServerRedirect() {
  const router = useRouter();
  useMountSubscription(() => {
    router.replace("/settings#system");
  }, [router]);
  return null;
}
