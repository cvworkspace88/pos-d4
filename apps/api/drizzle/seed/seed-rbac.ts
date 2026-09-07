import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import * as schema from '../../src/db/schema.ts';

const { roles, permissions, rolePermissions } = schema;

export const ROLES = [
  ['owner', 'Full access. Owns the business.'],
  ['manager', 'Full access. Approves what staff request.'],
  ['cashier', 'Rings up sales and takes payment.'],
  ['waiter', 'Takes orders and works the floor.'],
  ['inventory_staff', 'Receives, adjusts and transfers stock.'],
  ['auditor', 'Read-only across sales, products and inventory.'],
] as const;

/** A role name, narrowed to what `ROLES` actually lists — catches a typo in `PERMISSIONS` at compile time. */
export type RoleName = (typeof ROLES)[number][0];

/**
 * permission -> the roles that hold it *besides* owner and manager, who hold everything except
 * `OWNER_ONLY`. A permission with an empty list is therefore owner/manager only (every `_approve`
 * gate) — or owner only, if it is in `OWNER_ONLY`.
 */
export const PERMISSIONS: Record<string, RoleName[]> = {
  'sales.view': ['cashier', 'auditor'],
  'sales.create': ['cashier'],
  'sales.void_request': ['cashier'],
  'sales.void_approve': [],
  'sales.discount_request': ['cashier'],
  'sales.discount_approve': [],
  'sales.price_override_request': [],
  'sales.price_override_approve': [],

  'payments.accept': ['cashier'],
  'payments.refund_request': [],
  'payments.refund_approve': [],

  'product.view': ['cashier', 'inventory_staff', 'auditor'],
  'product.create': ['inventory_staff'],
  'product.edit': ['inventory_staff'],
  'product.price_edit': [],
  'product.delete': [],

  'inventory.view': ['inventory_staff', 'auditor'],
  'inventory.stock_adjust_request': ['inventory_staff'],
  'inventory.stock_adjust_approve': [],
  'inventory.receive_stock': ['inventory_staff'],
  'inventory.transfer_request': ['inventory_staff'],
  'inventory.transfer_approve': [],
  'inventory.purchase_order_create': ['inventory_staff'],
  'inventory.purchase_order_approve': [],
  'inventory.supplier_manage': [],

  'table.view': ['waiter', 'cashier'],
  'table.assign': ['waiter', 'cashier'],
  'table.transfer_request': ['waiter', 'cashier'],
  'table.transfer_approve': [],
  'table.merge_request': ['waiter', 'cashier'],
  'table.merge_approve': [],
  'table.close': ['waiter', 'cashier'],
  'table.force_close_request': ['waiter', 'cashier'],
  'table.force_close_approve': [],
  'table.reopen_request': ['waiter', 'cashier'],
  'table.reopen_approve': [],
  'table.layout_manage': [],

  'order.view': ['waiter', 'cashier', 'auditor'],
  'order.create': ['waiter', 'cashier'],
  'order.item_add': ['waiter', 'cashier'],
  'order.item_remove_request': ['waiter', 'cashier'],
  'order.item_remove_approve': [],
  'order.adjustment_request': ['waiter', 'cashier'],
  'order.adjustment_approve': [],
  // Kitchen tickets are the floor's job; a cashier never sends one.
  'order.send_to_kitchen': ['waiter'],
  'order.hold': ['waiter', 'cashier'],
  'order.cancel_request': ['waiter', 'cashier'],
  'order.cancel_approve': [],

  'settings.manage': [],
};

/** Permissions the owner alone holds — the one exception to "manager holds everything". */
export const OWNER_ONLY: ReadonlySet<string> = new Set(['settings.manage']);

/** The full holder list for a permission — owner and manager hold everything but `OWNER_ONLY`. */
export const holdersOf = (permission: string): string[] =>
  OWNER_ONLY.has(permission)
    ? ['owner']
    : [...new Set(['owner', 'manager', ...(PERMISSIONS[permission] ?? [])])];

/** Idempotent: re-running adds what is missing and touches nothing else. */
export async function seedRbac(db: NodePgDatabase<typeof schema>): Promise<void> {
  await db
    .insert(roles)
    .values(ROLES.map(([name, description]) => ({ name, description })))
    .onConflictDoNothing();

  await db
    .insert(permissions)
    .values(Object.keys(PERMISSIONS).map((name) => ({ name })))
    .onConflictDoNothing();

  const roleId = new Map((await db.select().from(roles)).map((r) => [r.name, r.id]));
  const permissionId = new Map((await db.select().from(permissions)).map((p) => [p.name, p.id]));

  const grants = Object.keys(PERMISSIONS).flatMap((permission) =>
    holdersOf(permission).map((role) => ({
      roleId: roleId.get(role)!,
      permissionId: permissionId.get(permission)!,
    })),
  );

  await db.insert(rolePermissions).values(grants).onConflictDoNothing();
  console.log(
    `rbac: ${ROLES.length} roles, ${Object.keys(PERMISSIONS).length} permissions, ${grants.length} grants`,
  );
}
