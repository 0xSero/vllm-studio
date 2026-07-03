"use client";

import { useRouter } from "next/navigation";
import api from "@/lib/api/client";
import { useMountSubscription } from "@/hooks/use-mount-subscription";

/**
 * First-run gate: a machine with a reachable controller but zero recipes and
 * no completed setup gets taken straight to the wizard instead of an empty
 * dashboard. Any failure (controller down, storage blocked) leaves the user
 * where they are — this must never trap someone outside their dashboard.
 */
export function useFirstRunRedirect() {
  const router = useRouter();

  useMountSubscription(() => {
    let cancelled = false;
    try {
      if (localStorage.getItem("local-studio-setup-complete") === "true") return;
    } catch {
      return;
    }
    void api
      .getRecipes()
      .then(({ recipes }) => {
        if (!cancelled && recipes.length === 0) {
          router.replace("/setup");
        }
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [router]);
}
