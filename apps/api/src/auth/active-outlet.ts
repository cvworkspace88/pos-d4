import { TRPCError } from '@trpc/server';
import type { Actor } from './rbac-rules';

/**
 * For outlet-scoped catalogue data (categories, menu): no procedure takes an outlet id, so there is
 * none from input to trust. An owner who has not picked an outlet has nothing to work on yet.
 */
export const activeOutlet = (ctx: Actor): string => {
  if (!ctx.outletId)
    throw new TRPCError({ code: 'PRECONDITION_FAILED', message: 'Pilih outlet terlebih dahulu.' });
  return ctx.outletId;
};
