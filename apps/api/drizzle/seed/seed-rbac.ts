import { and, inArray, notInArray, sql } from 'drizzle-orm';
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
 * permission -> every role that holds it besides owner, who holds all of them. Manager is listed
 * like any other role, so an empty list means the owner alone and a row is the whole answer.
 */
export const PERMISSIONS: Record<string, RoleName[]> = {
  'sales.view': ['manager', 'cashier', 'auditor'],
  'sales.create': ['manager', 'cashier'],
  'sales.void_request': ['manager', 'cashier'],
  'sales.void_approve': ['manager'],
  'sales.discount_request': ['manager', 'cashier'],
  'sales.discount_approve': ['manager'],
  'sales.price_override_request': ['manager'],
  'sales.price_override_approve': ['manager'],

  'payments.accept': ['manager', 'cashier'],
  'payments.refund_request': ['manager'],
  'payments.refund_approve': ['manager'],

  'product.view': ['manager', 'cashier', 'inventory_staff', 'auditor'],
  'product.create': ['manager', 'inventory_staff'],
  'product.edit': ['manager', 'inventory_staff'],
  'product.price_edit': ['manager'],
  'product.delete': ['manager'],

  'inventory.view': ['manager', 'inventory_staff', 'auditor'],
  'inventory.stock_adjust_request': ['manager', 'inventory_staff'],
  'inventory.stock_adjust_approve': ['manager'],
  'inventory.receive_stock': ['manager', 'inventory_staff'],
  'inventory.transfer_request': ['manager', 'inventory_staff'],
  'inventory.transfer_approve': ['manager'],
  'inventory.purchase_order_create': ['manager', 'inventory_staff'],
  'inventory.purchase_order_approve': ['manager'],
  'inventory.supplier_manage': ['manager'],

  'table.view': ['manager', 'waiter', 'cashier'],
  'table.create': ['manager'],
  'table.delete': ['manager'],
  // Move, resize, rename, seats.
  'table.layout_manage': ['manager'],
  'table.assign': ['manager', 'waiter', 'cashier'],
  'table.transfer_request': ['manager', 'waiter', 'cashier'],
  'table.transfer_approve': ['manager'],
  // Direct: join tables into a group for a big party and split them again. No approval step.
  'table.merge': ['manager', 'waiter', 'cashier'],
  'table.close': ['manager', 'waiter', 'cashier'],
  'table.force_close_request': ['manager', 'waiter', 'cashier'],
  'table.force_close_approve': ['manager'],
  'table.reopen_request': ['manager', 'waiter', 'cashier'],
  'table.reopen_approve': ['manager'],

  'reservation.view': ['manager', 'waiter', 'cashier'],
  'reservation.create': ['manager', 'waiter', 'cashier'],
  // Seat, no-show, cancel, edit while still booked.
  'reservation.update': ['manager', 'waiter', 'cashier'],

  'order.view': ['manager', 'waiter', 'cashier', 'auditor'],
  'order.create': ['manager', 'waiter', 'cashier'],
  'order.item_add': ['manager', 'waiter', 'cashier'],
  'order.item_remove_request': ['manager', 'waiter', 'cashier'],
  'order.item_remove_approve': ['manager'],
  'order.adjustment_request': ['manager', 'waiter', 'cashier'],
  'order.adjustment_approve': ['manager'],
  // Kitchen tickets are the floor's job; a cashier never sends one.
  'order.send_to_kitchen': ['manager', 'waiter'],
  'order.hold': ['manager', 'waiter', 'cashier'],
  'order.cancel_request': ['manager', 'waiter', 'cashier'],
  'order.cancel_approve': ['manager'],

  // The manager two are about one outlet, pinned to the session's own by `canActOn`; the
  // owner-only three are about the set of outlets. Reading your own outlet needs no permission.
  'outlet.manage': ['manager'],
  'outlet.staff_assign': ['manager'],

  'outlet.view_all': [],
  'outlet.create': [],
  'outlet.delete': [],

  // global app settings
  'settings.manage': [],
};

/**
 * Permission descriptions `permissions.description`.
 */
export const PERMISSION_DESCRIPTIONS: Record<string, string> = {
  'outlet.manage': 'Ubah pengaturan dan detail outlet.',
  'outlet.staff_assign': 'Atur staf di outlet.',
  'outlet.view_all': 'Lihat semua outlet.',
  'outlet.create': 'Tambah outlet.',
  'outlet.delete': 'Nonaktifkan atau aktifkan outlet.',
};

/** The full holder list for a permission. Owner is the only implicit holder; everyone else is listed. */
export const holdersOf = (permission: string): string[] => [
  ...new Set(['owner', ...(PERMISSIONS[permission] ?? [])]),
];

/** Idempotent: re-running adds what is missing and touches nothing else. */
export async function seedRbac(db: NodePgDatabase<typeof schema>): Promise<void> {
  await db
    .insert(roles)
    .values(ROLES.map(([name, description]) => ({ name, description })))
    .onConflictDoNothing();

  // Update, not DoNothing: a description added to an existing permission has to reach a database
  // that was seeded before it existed.
  await db
    .insert(permissions)
    .values(
      Object.keys(PERMISSIONS).map((name) => ({ name, description: PERMISSION_DESCRIPTIONS[name] ?? null })),
    )
    .onConflictDoUpdate({ target: permissions.name, set: { description: sql`excluded.description` } });

  // The seed is the source of truth: a permission dropped from PERMISSIONS leaves the database on
  // the next run, and its role_permissions rows go with it through the FK cascade. Roles are never
  // pruned — a user may still point at one.
  await db.delete(permissions).where(notInArray(permissions.name, Object.keys(PERMISSIONS)));

  const roleId = new Map((await db.select().from(roles)).map((r) => [r.name, r.id]));
  const permissionId = new Map((await db.select().from(permissions)).map((p) => [p.name, p.id]));

  const grants = Object.keys(PERMISSIONS).flatMap((permission) =>
    holdersOf(permission).map((role) => ({
      roleId: roleId.get(role)!,
      permissionId: permissionId.get(permission)!,
    })),
  );

  await db.insert(rolePermissions).values(grants).onConflictDoNothing();

  // And prune: a role dropped from a permission's list has to lose the grant on the next run.
  // Insert-only would leave it held forever, since the permission itself still exists and so
  // survives the delete above. Scoped to the roles `ROLES` still lists, so that a retired role
  // keeps what it had — pruning it would strip every user still pointing at it.
  await db.delete(rolePermissions).where(
    and(
      inArray(
        rolePermissions.roleId,
        ROLES.map(([name]) => roleId.get(name)!),
      ),
      sql`(${rolePermissions.roleId}, ${rolePermissions.permissionId}) not in (${sql.join(
        grants.map((g) => sql`(${g.roleId}::uuid, ${g.permissionId}::uuid)`),
        sql`, `,
      )})`,
    ),
  );
  console.log(
    `rbac: ${ROLES.length} roles, ${Object.keys(PERMISSIONS).length} permissions, ${grants.length} grants`,
  );
}
