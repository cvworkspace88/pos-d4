/**
 * A reorder must name every live category of the outlet exactly once. Anything else means the list
 * changed under the client (added, deleted, another outlet's id) and the client must refetch.
 */
export const checkReorder = (liveIds: readonly string[], inputIds: readonly string[]): boolean => {
  const input = new Set(inputIds);
  return (
    input.size === inputIds.length &&
    input.size === liveIds.length &&
    liveIds.every((id) => input.has(id))
  );
};
