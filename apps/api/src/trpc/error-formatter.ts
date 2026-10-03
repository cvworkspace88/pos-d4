import { randomUUID } from 'node:crypto';
import { Logger } from '@nestjs/common';
import type { TRPCDefaultErrorShape, TRPCErrorFormatter } from '@trpc/server';

const logger = new Logger('trpc');

/**
 * `INVALID_PIN`: wrong digits, the session is fine. `NEEDS_APPROVAL`: a manager's PIN can lift this
 * refusal (US-010). `LOCKED`: too many wrong passwords or PINs at login; wait, or a staff manager resets it.
 */
type ReasonCode = 'INVALID_PIN' | 'NEEDS_APPROVAL' | 'LOCKED' | 'NEEDS_PASSWORD';

/**
 * A machine-readable discriminant for failures that deliberately share one tRPC code.
 *
 * It has to be an `Error` subclass: `TRPCError` runs every `cause` through `getCauseFromUnknown`,
 * which turns a plain string into `new Error(string)` — so a string cause never survives as one.
 * Reading `cause.message` instead would put any thrown error's text on the wire, hence a type only
 * we construct.
 */
export class Reason extends Error {
  // Declared, not a parameter property: `node --test` strips types rather than compiling them.
  readonly reason: ReasonCode;

  constructor(reason: ReasonCode) {
    super(reason);
    this.reason = reason;
  }
}

/**
 * Publishes `Reason` as `data.reason`; tRPC does not serialize `cause` on its own. `auth.pinLogin`
 * answers a wrong PIN and a dead profile both with UNAUTHORIZED, and only this tells them apart.
 */
export const errorFormatter: TRPCErrorFormatter<Record<string, unknown>, TRPCDefaultErrorShape> = ({
  shape,
  error,
  path,
}) => {
  const traceId = randomUUID();
  logger.error(`[${traceId}] ${path ?? 'unknown'} ${error.code}: ${error.message}`, error.stack);
  return {
    ...shape,
    data: { ...shape.data, reason: error.cause instanceof Reason ? error.cause.reason : undefined, traceId },
  };
};
