import { Effect } from "effect";
import { useCallback, useRef, useState, type SetStateAction } from "react";
import { useMountSubscription } from "@/hooks/use-mount-subscription";

type AsyncResourceOptions<A> = {
  clearOnError?: boolean;
  onLoaded?: (value: A) => void;
};

export function useAsyncResource<A>(
  load: () => Promise<A>,
  initial: A,
  failure: string,
  options: AsyncResourceOptions<A> = {},
) {
  const fallback = useRef(initial);
  const [data, setData] = useState(initial);
  const [status, setStatus] = useState({ loaded: false, loading: true, error: "" });
  const generation = useRef(0);
  const clearOnError = options.clearOnError ?? false;
  const onLoaded = options.onLoaded;

  const refresh = useCallback(() => {
    const current = ++generation.current;
    setStatus((value) => ({ ...value, loading: true, error: "" }));
    return Effect.runPromise(Effect.tryPromise({ try: load, catch: (cause) => cause })).then(
      (value) => {
        if (current !== generation.current) return undefined;
        setData(value);
        onLoaded?.(value);
        setStatus({ loaded: true, loading: false, error: "" });
        return value;
      },
      (cause) => {
        if (current !== generation.current) return undefined;
        if (clearOnError) setData(fallback.current);
        setStatus({
          loaded: true,
          loading: false,
          error: cause instanceof Error ? cause.message : failure,
        });
        return undefined;
      },
    );
  }, [clearOnError, failure, load, onLoaded]);

  useMountSubscription(() => {
    void refresh();
    return () => void (generation.current += 1);
  }, [refresh]);

  const invalidate = useCallback(() => {
    generation.current += 1;
    setStatus((value) => ({ ...value, loaded: true, loading: false }));
  }, []);
  const setError = (value: SetStateAction<string>) =>
    setStatus((current) => ({
      ...current,
      error: typeof value === "function" ? value(current.error) : value,
    }));
  return { data, setData, ...status, setError, refresh, invalidate };
}
