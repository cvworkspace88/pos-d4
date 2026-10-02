/** What an overridable mutation accepts besides its own input: a manager's PIN approval (US-010). */
export type Approval = { approverUserId: string; pin: string; reason?: string };

/**
 * `data.reason` off a tRPC error. The generated contract is built without the server's error
 * formatter, so the field is not in the inferred error type — the cast lives here, once.
 */
export const errorReason = (error: unknown): string | undefined => {
  const reason = (error as { data?: { reason?: unknown } } | null | undefined)?.data?.reason;
  return typeof reason === 'string' ? reason : undefined;
};

/** Refused for want of a permission a manager may approve: open "Minta akses". */
export const needsApproval = (error: unknown): boolean => errorReason(error) === 'NEEDS_APPROVAL';

/** Wrong PIN digits: a failed attempt, never a dead session. */
export const isInvalidPin = (error: unknown): boolean => errorReason(error) === 'INVALID_PIN';
