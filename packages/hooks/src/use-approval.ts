import { useState } from 'react';
import { isInvalidPin, needsApproval, type Approval } from '@repo/api-contract';

/** What `ApprovalDialog` needs of a `useApproval` result. */
export interface ApprovalControl {
  permission: string;
  pending: unknown;
  submit: (approval: Approval) => Promise<void>;
  close: () => void;
}

/**
 * The manager-PIN override around one mutation (US-010). Two ways in, one dialog:
 * - `run(input)` sends first and opens the dialog if the server answers NEEDS_APPROVAL;
 * - `request(input)` opens it straight away, for a screen that already knows it lacks the permission;
 * - `start(input, held)` picks one from a client-side `can(permission)`.
 * `run` still catches NEEDS_APPROVAL, so a check-first screen stays right when its cached
 * permissions are stale. `submit` resends the same input with the approval. A failed approval (wrong
 * PIN, lock, approver without access or PIN — INVALID_PIN or FORBIDDEN) rejects, for the dialog to show.
 * Any other error means the approved action itself lost (state changed elsewhere): `submit` closes the
 * dialog, puts it in `error` and `onError` like `run` does, and resolves.
 */
export function useApproval<I extends { approval?: Approval }>(
  permission: string,
  send: (input: I) => Promise<unknown>,
  onError?: (error: Error) => void,
) {
  const [pending, setPending] = useState<I | null>(null);
  const [error, setError] = useState<Error | null>(null);

  const run = async (input: I) => {
    setError(null);
    try {
      await send(input);
    } catch (caught) {
      if (needsApproval(caught)) {
        setPending(input);
        return;
      }
      setError(caught as Error);
      onError?.(caught as Error);
    }
  };

  const request = (input: I) => {
    setError(null);
    setPending(input);
  };

  const start = (input: I, held: boolean) => (held ? run(input) : request(input));

  const submit = async (approval: Approval) => {
    if (!pending) return;
    try {
      await send({ ...pending, approval });
    } catch (caught) {
      const code = (caught as { data?: { code?: unknown } } | null)?.data?.code;
      if (isInvalidPin(caught) || code === 'FORBIDDEN') throw caught;
      setError(caught as Error);
      onError?.(caught as Error);
    }
    setPending(null);
  };

  const close = () => setPending(null);

  return { permission, pending, error, run, request, start, submit, close };
}
