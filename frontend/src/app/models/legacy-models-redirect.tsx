import { permanentRedirect } from "next/navigation";

type LegacyModelsRedirectProps = {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

const MODEL_INTENT_KEYS = ["tab", "new"] as const;

export async function LegacyModelsRedirect({ searchParams }: LegacyModelsRedirectProps) {
  const source = await searchParams;
  const target = new URLSearchParams();
  for (const key of MODEL_INTENT_KEYS) {
    const value = source[key];
    if (Array.isArray(value)) {
      for (const item of value) target.append(key, item);
    } else if (value !== undefined) {
      target.set(key, value);
    }
  }
  permanentRedirect(`/models${target.size ? `?${target.toString()}` : ""}`);
}
