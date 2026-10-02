import type { RouterOutputs } from '@repo/api-contract';

export type AuditRow = RouterOutputs['audit']['list']['rows'][number];
export type AuditModule = AuditRow['module'];

export const MODULE_LABEL: Record<AuditModule, string> = {
  settings: 'Pengaturan aplikasi',
  outlet: 'Outlet',
  staff: 'Staf',
  category: 'Kategori',
  menu: 'Menu',
  addon: 'Add-on',
  role: 'Peran',
  approval: 'Akses',
};

const ACTION_LABEL: Record<string, string> = {
  'settings.update': 'Ubah pengaturan aplikasi',
  'outlet.create': 'Tambah outlet',
  'outlet.update': 'Ubah profil outlet',
  'outlet.set_code': 'Ubah kode outlet',
  'outlet.set_charges': 'Ubah pajak & biaya layanan',
  'outlet.set_business_day': 'Ubah hari bisnis',
  'outlet.set_active': 'Aktifkan / nonaktifkan outlet',
  'staff.add': 'Tambah staf',
  'staff.set_roster': 'Ubah daftar staf',
  'category.create': 'Tambah kategori',
  'category.update': 'Ubah kategori',
  'category.delete': 'Hapus kategori',
  'category.reorder': 'Ubah urutan kategori',
  'menu.item_create': 'Tambah menu',
  'menu.item_update': 'Ubah menu',
  'menu.item_set_active': 'Aktifkan / nonaktifkan menu',
  'menu.item_delete': 'Hapus menu',
  'addon.create': 'Tambah grup add-on',
  'addon.update': 'Ubah grup add-on',
  'addon.delete': 'Hapus grup add-on',
  'role.create': 'Tambah peran',
  'role.update': 'Ubah peran',
  'role.delete': 'Hapus peran',
  'role.override': 'Ubah izin staf',
  'approval.granted': 'Akses manajer',
  'approval.blocked': 'Akses diblokir',
  'approval.unblocked': 'Buka blokir akses',
};

/** An action added on the server before this list learns it still shows, as its code. */
export const actionLabel = (action: string) => ACTION_LABEL[action] ?? action;

/** What the row is about, by name when the snapshot carries one. */
export const subjectOf = (row: AuditRow): string => {
  const name = row.after?.name ?? row.before?.name ?? row.after?.permission;
  return typeof name === 'string' ? name : '';
};

/** One cell of the before/after table. */
// ponytail: field keys show as their code names (serviceRateBp); add a label map when users ask.
export const formatValue = (value: unknown): string => {
  if (value === null || value === undefined) return '—';
  if (typeof value === 'boolean') return value ? 'Ya' : 'Tidak';
  if (typeof value === 'string' || typeof value === 'number') return String(value);
  return JSON.stringify(value);
};
