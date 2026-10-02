import { and, inArray, notInArray, sql } from 'drizzle-orm';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import * as schema from '../../src/db/schema.ts';

const { roles, permissions, rolePermissions } = schema;

/** The base roles (PRD Appendix B). Locked: the seed owns their grants; the owner adds custom roles instead. */
export const ROLES = [
  ['owner', 'Full access. Owns the business.'],
  ['manager', 'Runs an outlet: everything but roles, overrides, app settings and the set of outlets.'],
  [
    'supervisor',
    'Runs the shift: everything a cashier does, plus voids, comps, cancellations and approvals.',
  ],
  ['cashier', 'Takes orders and payment, opens and closes the shift.'],
  ['waiter', 'Takes orders and works the floor.'],
  ['kitchen', 'Sees and bumps kitchen tickets, marks items sold out.'],
  ['accountant', 'Read-only: menu, stock, customers and reports.'],
] as const;

export type RoleName = (typeof ROLES)[number][0];

// One permission per action (PRD Appendix B). Someone without it is refused, and the manager PIN
// override (US-010) lets an approver holding it plus `approval.grant` complete the action.
export const PERMISSIONS: Record<string, { label: string; roles: RoleName[] }> = {
  'order.create': { label: 'Buat pesanan', roles: ['manager', 'supervisor', 'cashier', 'waiter'] },
  'order.edit_others': { label: 'Ubah pesanan orang lain', roles: ['manager', 'supervisor'] },
  'order.send': { label: 'Kirim pesanan ke dapur', roles: ['manager', 'supervisor', 'cashier', 'waiter'] },
  'order.void_sent': { label: 'Void item yang sudah dikirim', roles: ['manager', 'supervisor'] },
  'order.comp': { label: 'Gratiskan item', roles: ['manager', 'supervisor'] },
  'order.discount_line': { label: 'Diskon per item', roles: ['manager', 'supervisor', 'cashier'] },
  'order.discount_bill': { label: 'Diskon per tagihan', roles: ['manager', 'supervisor', 'cashier'] },
  'order.price_override': { label: 'Ubah harga di pesanan', roles: ['manager'] },
  'order.transfer': { label: 'Pindah pesanan', roles: ['manager', 'supervisor', 'cashier', 'waiter'] },
  'order.merge': { label: 'Gabung tagihan', roles: ['manager', 'supervisor', 'cashier', 'waiter'] },
  'order.split': { label: 'Pisah tagihan', roles: ['manager', 'supervisor', 'cashier', 'waiter'] },
  'order.reopen': { label: 'Buka kembali tagihan', roles: ['manager'] },
  'order.cancel': { label: 'Batalkan pesanan', roles: ['manager', 'supervisor'] },

  'payment.take': { label: 'Terima pembayaran', roles: ['manager', 'supervisor', 'cashier'] },
  'payment.void': { label: 'Void pembayaran', roles: ['manager', 'supervisor'] },
  'payment.refund': { label: 'Refund', roles: ['manager'] },
  'payment.reprint': { label: 'Cetak ulang struk', roles: ['manager', 'supervisor', 'cashier'] },

  'shift.open': { label: 'Buka shift', roles: ['manager', 'supervisor', 'cashier'] },
  'shift.close': { label: 'Tutup shift', roles: ['manager', 'supervisor', 'cashier'] },
  'shift.close_blind': { label: 'Tutup shift hitung buta', roles: ['manager'] },
  'shift.view_expected': { label: 'Lihat saldo kas seharusnya', roles: ['manager', 'supervisor'] },
  'shift.approve_variance': { label: 'Setujui selisih kas', roles: ['manager', 'supervisor'] },
  'drawer.pay_in_out': { label: 'Kas masuk / keluar', roles: ['manager', 'supervisor', 'cashier'] },
  'drawer.no_sale': { label: 'Buka laci tanpa transaksi', roles: ['manager', 'supervisor'] },
  'day.close': { label: 'Tutup hari', roles: ['manager'] },

  // The active outlet's menu. The floor and counter read it to take orders; managing it is the manager's.
  'menu.view': {
    label: 'Lihat menu',
    roles: ['manager', 'supervisor', 'cashier', 'waiter', 'kitchen', 'accountant'],
  },
  // Add, edit, tax, active.
  'menu.manage': { label: 'Kelola menu', roles: ['manager'] },
  'menu.sold_out': {
    label: 'Tandai menu habis',
    roles: ['manager', 'supervisor', 'cashier', 'waiter', 'kitchen'],
  },
  'menu.price': { label: 'Ubah harga menu', roles: ['manager'] },
  // Menu categories of the active outlet: their names and the order the cashier screen shows them in.
  'category.view': { label: 'Lihat kategori', roles: ['manager'] },
  // Add, update, delete, reorder.
  'category.edit': { label: 'Kelola kategori', roles: ['manager'] },

  'table.view': { label: 'Lihat meja', roles: ['manager', 'supervisor', 'cashier', 'waiter'] },
  // Seat guests, close the table.
  'table.use': {
    label: 'Tempatkan tamu & tutup meja',
    roles: ['manager', 'supervisor', 'cashier', 'waiter'],
  },
  // Join tables into a group for a big party and split them again.
  'table.merge': { label: 'Gabung & pisah meja', roles: ['manager', 'supervisor', 'cashier', 'waiter'] },
  'table.create': { label: 'Tambah meja', roles: ['manager'] },
  'table.delete': { label: 'Hapus meja', roles: ['manager'] },
  // Move, resize, rename, seats.
  'table.layout_manage': { label: 'Atur denah meja', roles: ['manager'] },

  'kitchen.view': { label: 'Lihat layar dapur', roles: ['manager', 'supervisor', 'kitchen'] },
  'kitchen.bump': { label: 'Selesaikan tiket dapur', roles: ['manager', 'kitchen'] },

  'reservation.view': { label: 'Lihat reservasi', roles: ['manager', 'supervisor', 'cashier', 'waiter'] },
  'reservation.create': { label: 'Buat reservasi', roles: ['manager', 'supervisor', 'cashier', 'waiter'] },
  // Seat, no-show, cancel, edit while still booked.
  'reservation.update': {
    label: 'Ubah status reservasi',
    roles: ['manager', 'supervisor', 'cashier', 'waiter'],
  },

  'inventory.view': { label: 'Lihat stok', roles: ['manager', 'accountant'] },
  'inventory.adjust': { label: 'Sesuaikan stok', roles: ['manager'] },
  'inventory.count': { label: 'Stok opname', roles: ['manager'] },
  'inventory.receive': { label: 'Terima barang masuk', roles: ['manager'] },
  'inventory.transfer': { label: 'Transfer stok', roles: ['manager'] },

  'customer.view': {
    label: 'Lihat pelanggan',
    roles: ['manager', 'supervisor', 'cashier', 'waiter', 'accountant'],
  },
  'customer.manage': { label: 'Kelola pelanggan', roles: ['manager', 'supervisor', 'cashier'] },

  'report.view_sales': { label: 'Lihat laporan penjualan', roles: ['manager', 'supervisor', 'accountant'] },
  'report.view_shift': {
    label: 'Lihat laporan shift',
    roles: ['manager', 'supervisor', 'cashier', 'accountant'],
  },
  // Who changed what (US-011). The outlet's own log; global rows (app settings, roles) only for a global role.
  'report.view_audit': { label: 'Lihat log audit', roles: ['manager', 'accountant'] },
  'report.export': { label: 'Ekspor laporan', roles: ['manager', 'accountant'] },

  // Staff accounts: create, reset password, clear PIN (US-057).
  'staff.manage': { label: 'Kelola akun staf', roles: ['manager'] },
  // The roles & permissions page.
  'role.view': { label: 'Lihat peran & izin', roles: [] },
  // Create, edit and delete custom roles. Base roles are locked whoever you are.
  'role.manage': { label: 'Kelola peran', roles: [] },
  // Grant or revoke one permission for one person at one outlet.
  'permission.override': { label: 'Atur izin per staf', roles: [] },
  // Deployment-wide app settings.
  'settings.manage': { label: 'Kelola pengaturan aplikasi', roles: [] },
  'device.manage': { label: 'Kelola perangkat', roles: ['manager'] },
  'sync.manage': { label: 'Kelola sinkronisasi', roles: ['manager'] },
  // Approve someone else's refused action with your PIN (US-010).
  'approval.grant': { label: 'Beri persetujuan dengan PIN', roles: ['manager', 'supervisor'] },

  // The manager two are about one outlet, pinned to the session's own by `canActOn`; the
  // owner-only three are about the set of outlets. Reading your own outlet needs no permission.
  'outlet.manage': { label: 'Ubah detail outlet', roles: ['manager'] },
  'outlet.staff_assign': { label: 'Atur staf outlet', roles: ['manager'] },
  'outlet.view_all': { label: 'Lihat semua outlet', roles: [] },
  'outlet.create': { label: 'Tambah outlet', roles: [] },
  'outlet.delete': { label: 'Aktifkan / nonaktifkan outlet', roles: [] },
};

/** The full holder list for a permission. Owner is the only implicit holder; everyone else is listed. */
export const holdersOf = (permission: string): string[] => [
  ...new Set(['owner', ...(PERMISSIONS[permission]?.roles ?? [])]),
];

/** Idempotent: re-running adds what is missing and touches nothing else. */
export async function seedRbac(db: NodePgDatabase<typeof schema>): Promise<void> {
  // Update, not DoNothing: an existing database has to pick up the flags and new descriptions.
  await db
    .insert(roles)
    .values(
      ROLES.map(([name, description]) => ({
        name,
        description,
        isGlobal: name === 'owner',
        editable: false,
      })),
    )
    .onConflictDoUpdate({
      target: roles.name,
      set: {
        description: sql`excluded.description`,
        isGlobal: sql`excluded.is_global`,
        editable: sql`excluded.editable`,
      },
    });

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
