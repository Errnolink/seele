import { useEffect, useState } from "react";

/**
 * Debounce a rapidly-changing value. Returns a value that only updates
 * after `delayMs` has elapsed without a change, so expensive downstream
 * work (filtering 100k files) doesn't run on every keystroke.
 *
 * Review issue #24 — the search input fed `setSearchQuery` directly and
 * the filter `useMemo` ran on every keystroke.
 */
export function useDebouncedValue<T>(value: T, delayMs = 200): T {
  const [debounced, setDebounced] = useState(value);

  useEffect(() => {
    const id = setTimeout(() => setDebounced(value), delayMs);
    return () => clearTimeout(id);
  }, [value, delayMs]);

  return debounced;
}
