import { useCallback, useState, type ChangeEvent } from 'react';
import { useDebounce } from './use-debounce';

/**
 * State for a search box: `field` is the raw input value (bind it to `value`, never trimmed),
 * `query` is `field` trimmed and debounced by `debounceTime` ms (put it in the request / query key,
 * so whitespace-only input yields `''`). `onChange` takes the input's change event or a plain string.
 *
 * ```tsx
 * const search = useSearchQuery();
 * const list = useQuery(trpc.menu.list.queryOptions({ q: search.query }));
 * <TextField value={search.field} onChange={search.onChange} />
 * ```
 */
export function useSearchQuery(defaultValue = '', debounceTime = 300) {
  const [field, setField] = useState(defaultValue);
  const query = useDebounce(field.trim(), debounceTime);
  const onChange = useCallback((eventOrValue: string | ChangeEvent<HTMLInputElement>) => {
    setField(typeof eventOrValue === 'string' ? eventOrValue : eventOrValue.target.value);
  }, []);
  return { query, field, onChange };
}
