import { useEffect, useState } from 'react';

/**
 * `value`, but only once it has held still for `delay` ms — for a search box that should query
 * when the typing stops, not on every key.
 */
export function useDebounce<T>(value: T, delay = 250): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), delay);
    return () => clearTimeout(timer);
  }, [value, delay]);
  return debounced;
}
