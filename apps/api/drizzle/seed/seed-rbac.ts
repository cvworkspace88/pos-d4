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

export type RoleName = (typeof ROLES)[number][0];

export const PERMISSIONS: Record<string, { label: string; roles: RoleName[] }> = {
  'sales.view': { label: 'Lihat penjualan', roles: ['manager', 'cashier', 'auditor'] },
  'sales.create': { label: 'Buat penjualan', roles: ['manager', 'cashier'] },
  'sales.void_request': { label: 'Ajukan void penjualan', roles: ['manager', 'cashier'] },
  'sales.void_approve': { label: 'Setujui void penjualan', roles: ['manager'] },
  'sales.discount_request': { label: 'Ajukan diskon', roles: ['manager', 'cashier'] },
  'sales.discount_approve': { label: 'Setujui diskon', roles: ['manager'] },
  'sales.price_override_request': { label: 'Ajukan ubah harga', roles: ['manager'] },
  'sales.price_override_approve': { label: 'Setujui ubah harga', roles: ['manager'] },

  'payments.accept': { label: 'Terima pembayaran', roles: ['manager', 'cashier'] },
  'payments.refund_request': { label: 'Ajukan refund', roles: ['manager'] },
  'payments.refund_approve': { label: 'Setujui refund', roles: ['manager'] },

  'product.view': { label: 'Lihat produk', roles: ['manager', 'cashier', 'inventory_staff', 'auditor'] },
  'product.create': { label: 'Tambah produk', roles: ['manager', 'inventory_staff'] },
  'product.edit': { label: 'Ubah produk', roles: ['manager', 'inventory_staff'] },
  'product.price_edit': { label: 'Ubah harga produk', roles: ['manager'] },
  'product.delete': { label: 'Hapus produk', roles: ['manager'] },

  'inventory.view': { label: 'Lihat stok', roles: ['manager', 'inventory_staff', 'auditor'] },
  'inventory.stock_adjust_request': {
    label: 'Ajukan penyesuaian stok',
    roles: ['manager', 'inventory_staff'],
  },
  'inventory.stock_adjust_approve': { label: 'Setujui penyesuaian stok', roles: ['manager'] },
  'inventory.receive_stock': { label: 'Terima barang masuk', roles: ['manager', 'inventory_staff'] },
  'inventory.transfer_request': { label: 'Ajukan transfer stok', roles: ['manager', 'inventory_staff'] },
  'inventory.transfer_approve': { label: 'Setujui transfer stok', roles: ['manager'] },
  'inventory.purchase_order_create': { label: 'Buat purchase order', roles: ['manager', 'inventory_staff'] },
  'inventory.purchase_order_approve': { label: 'Setujui purchase order', roles: ['manager'] },
  'inventory.supplier_manage': { label: 'Kelola supplier', roles: ['manager'] },

  'table.view': { label: 'Lihat meja', roles: ['manager', 'waiter', 'cashier'] },
  'table.create': { label: 'Tambah meja', roles: ['manager'] },
  'table.delete': { label: 'Hapus meja', roles: ['manager'] },
  // Move, resize, rename, seats.
  'table.layout_manage': { label: 'Atur denah meja', roles: ['manager'] },
  'table.assign': { label: 'Tempatkan tamu di meja', roles: ['manager', 'waiter', 'cashier'] },
  'table.transfer_request': { label: 'Ajukan pindah meja', roles: ['manager', 'waiter', 'cashier'] },
  'table.transfer_approve': { label: 'Setujui pindah meja', roles: ['manager'] },
  // Direct: join tables into a group for a big party and split them again. No approval step.
  'table.merge': { label: 'Gabung & pisah meja', roles: ['manager', 'waiter', 'cashier'] },
  'table.close': { label: 'Tutup meja', roles: ['manager', 'waiter', 'cashier'] },
  'table.force_close_request': { label: 'Ajukan tutup paksa meja', roles: ['manager', 'waiter', 'cashier'] },
  'table.force_close_approve': { label: 'Setujui tutup paksa meja', roles: ['manager'] },
  'table.reopen_request': { label: 'Ajukan buka kembali meja', roles: ['manager', 'waiter', 'cashier'] },
  'table.reopen_approve': { label: 'Setujui buka kembali meja', roles: ['manager'] },

  'reservation.view': { label: 'Lihat reservasi', roles: ['manager', 'waiter', 'cashier'] },
  'reservation.create': { label: 'Buat reservasi', roles: ['manager', 'waiter', 'cashier'] },
  // Seat, no-show, cancel, edit while still booked.
  'reservation.update': { label: 'Ubah status reservasi', roles: ['manager', 'waiter', 'cashier'] },

  'order.view': { label: 'Lihat pesanan', roles: ['manager', 'waiter', 'cashier', 'auditor'] },
  'order.create': { label: 'Buat pesanan', roles: ['manager', 'waiter', 'cashier'] },
  'order.item_add': { label: 'Tambah item pesanan', roles: ['manager', 'waiter', 'cashier'] },
  'order.item_remove_request': {
    label: 'Ajukan hapus item pesanan',
    roles: ['manager', 'waiter', 'cashier'],
  },
  'order.item_remove_approve': { label: 'Setujui hapus item pesanan', roles: ['manager'] },
  'order.adjustment_request': {
    label: 'Ajukan penyesuaian pesanan',
    roles: ['manager', 'waiter', 'cashier'],
  },
  'order.adjustment_approve': { label: 'Setujui penyesuaian pesanan', roles: ['manager'] },
  // Kitchen tickets are the floor's job; a cashier never sends one.
  'order.send_to_kitchen': { label: 'Kirim pesanan ke dapur', roles: ['manager', 'waiter'] },
  'order.hold': { label: 'Tahan pesanan', roles: ['manager', 'waiter', 'cashier'] },
  'order.cancel_request': { label: 'Ajukan batal pesanan', roles: ['manager', 'waiter', 'cashier'] },
  'order.cancel_approve': { label: 'Setujui batal pesanan', roles: ['manager'] },

  // The manager two are about one outlet, pinned to the session's own by `canActOn`; the
  // owner-only three are about the set of outlets. Reading your own outlet needs no permission.
  'outlet.manage': { label: 'Ubah detail outlet', roles: ['manager'] },
  'outlet.staff_assign': { label: 'Atur staf outlet', roles: ['manager'] },

  'outlet.view_all': { label: 'Lihat semua outlet', roles: [] },
  'outlet.create': { label: 'Tambah outlet', roles: [] },
  'outlet.delete': { label: 'Aktifkan / nonaktifkan outlet', roles: [] },

  // global app settings
  'settings.manage': { label: 'Kelola pengaturan aplikasi', roles: [] },

  // The roles & permissions page. Read-only for now; owner alone.
  'role.view': { label: 'Lihat peran & izin', roles: [] },
};

/** The full holder list for a permission. Owner is the only implicit holder; everyone else is listed. */
export const holdersOf = (permission: string): string[] => [
  ...new Set(['owner', ...(PERMISSIONS[permission]?.roles ?? [])]),
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
      // `description` holds the Indonesian label the UI shows; the dotted name stays the key code checks.
      Object.entries(PERMISSIONS).map(([name, { label }]) => ({ name, description: label })),
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
