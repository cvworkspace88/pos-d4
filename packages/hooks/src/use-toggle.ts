import { useState } from 'react';

/**
 * Boolean state with the flip already written. The third slot is the plain setter, for the places
 * that know which way they want it — closing after a successful save, say, rather than toggling.
 *
 * Nothing here is memoised: a new `toggle` each render is cheaper than the dependency array that
 * would keep it stable, and no consumer passes it to a memoised child.
 */
export function useToggle(initial = false) {
  const [on, set] = useState(initial);
  return [on, () => set((v) => !v), set] as const;
}
