import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Search, TriangleAlertIcon } from 'lucide-react';
import { useState } from 'react';
import type { RouterOutputs } from '@repo/api-contract';
import { Alert } from '@repo/ui/alert';
import { Button } from '@repo/ui/button';
import { Card } from '@repo/ui/card';
import { Dialog } from '@repo/ui/dialog';
import { Pill, type PillProps } from '@repo/ui/pill';
import { Skeleton } from '@repo/ui/skeleton';
import { StateMessageLayout } from '@repo/ui/state-message-layout';
import { TextField } from '@repo/ui/text-field';
import { PageHeader } from '../components/page-header';
import { useAuthStore } from '../stores/auth';
import { useTRPC } from '../trpc';

type Member = RouterOutputs['outlet']['staff'][number];

// Role names are seed keys, not copy. An unknown one shows as-is rather than blank.
const ROLE_LABEL: Record<string, string> = {
  manager: 'Manajer',
  cashier: 'Kasir',
  waiter: 'Pelayan',
  inventory_staff: 'Staf gudang',
  auditor: 'Auditor',
};
const ROLE_TONE: Record<string, PillProps['tone']> = { manager: 'warning', cashier: 'success' };
const roleLabel = (name: string) => ROLE_LABEL[name] ?? name;

const SELECT =
  'rounded-xl border border-border bg-surface px-4 py-3 text-base text-ink-primary outline-none focus:border-primary';

/** The active outlet's roster: who works here and as what. The sidebar switcher decides which outlet. */
export default function StaffPage() {
  const trpc = useTRPC();
  const queryClient = useQueryClient();
  const outlet = useAuthStore((s) => s.outlet);
  const outletId = outlet?.id ?? '';

  const staff = useQuery(trpc.outlet.staff.queryOptions({ outletId }, { enabled: !!outlet }));
  const roles = useQuery(trpc.outlet.roles.queryOptions());

  const [search, setSearch] = useState('');
  const [role, setRole] = useState('');
  const [editing, setEditing] = useState<Member | null>(null);
  const [removing, setRemoving] = useState<Member | null>(null);
  const [roleId, setRoleId] = useState('');

  // `setStaff` replaces the whole roster, so an edit or a removal is the current list, changed.
  // ponytail: last write wins between two admins editing the same roster at once; send the
  // expected roster and answer CONFLICT on mismatch if that ever bites.
  const save = useMutation(
    trpc.outlet.setStaff.mutationOptions({
      onSuccess: (roster) => {
        queryClient.setQueryData(trpc.outlet.staff.queryKey({ outletId }), roster);
        close();
      },
    }),
  );
  const write = (next: Member[]) =>
    save
      .mutateAsync({ outletId, staff: next.map((m) => ({ userId: m.id, roleId: m.roleId })) })
      .catch(() => undefined);

  const close = () => {
    setEditing(null);
    setRemoving(null);
    save.reset();
  };

  const q = search.trim().toLowerCase();
  const rows = staff.data?.filter(
    (m) =>
      (!role || m.roleId === role) &&
      (!q || m.username.toLowerCase().includes(q) || m.name.toLowerCase().includes(q)),
  );

  const failed = staff.error && !staff.data;

  const saveError = save.error && (
    <div className="text-danger text-sm flex items-center flex-row gap-1">
      <TriangleAlertIcon className="size-4" /> {save.error.message}
    </div>
  );

  return (
    <>
      <PageHeader title="Staf" subtitle={outlet?.name ?? 'Belum ada outlet aktif'} />
      <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-auto p-6">
        {!failed && (
          <div className="flex flex-wrap items-end gap-3">
            <div className="w-72">
              <TextField
                type="search"
                placeholder="Cari username atau nama"
                aria-label="Cari staf"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                adornment={<Search className="size-4 shrink-0 text-ink-tertiary" aria-hidden />}
              />
            </div>
            <select
              aria-label="Filter peran"
              className={SELECT}
              value={role}
              onChange={(e) => setRole(e.target.value)}
            >
              <option value="">Semua peran</option>
              {roles.data?.map((r) => (
                <option key={r.id} value={r.id}>
                  {roleLabel(r.name)}
                </option>
              ))}
            </select>
          </div>
        )}

        {failed ? (
          <Card className="min-h-0 flex-1 items-center justify-center">
            <StateMessageLayout
              tone="danger"
              title="Gagal memuat daftar staf"
              description={staff.error.message}
            >
              <Button size="sm" onClick={() => void staff.refetch()} disabled={staff.isFetching}>
                {staff.isFetching ? 'Memuat…' : 'Coba lagi'}
              </Button>
            </StateMessageLayout>
          </Card>
        ) : (
          <Card className="min-h-0 flex-1 overflow-auto !gap-0 !p-0">
            {staff.error && (
              <Alert variant="danger" role="alert" className="m-4">
                {staff.error.message}
              </Alert>
            )}

            <table className="w-full text-sm" aria-busy={staff.isPending}>
              <thead className="border-b border-border-subtle text-left text-xs uppercase tracking-wider text-ink-tertiary">
                <tr>
                  <th className="px-4 py-3 font-semibold">Username</th>
                  <th className="px-4 py-3 font-semibold">Nama</th>
                  <th className="px-4 py-3 font-semibold">Peran</th>
                  <th className="px-4 py-3 text-right font-semibold">Aksi</th>
                </tr>
              </thead>
              <tbody>
                {staff.isPending &&
                  outlet &&
                  Array.from({ length: 5 }, (_, i) => (
                    <tr key={i} className="border-b border-border-muted last:border-0">
                      {[32, 48, 20, 16].map((w) => (
                        <td key={w} className="px-4 py-3">
                          <Skeleton className="h-4" style={{ width: `${w}%` }} />
                        </td>
                      ))}
                    </tr>
                  ))}

                {rows?.map((m) => (
                  <tr key={m.id} className="border-b border-border-muted last:border-0">
                    <td className="px-4 py-3 font-medium text-ink-primary">{m.username}</td>
                    <td className="px-4 py-3 text-ink-secondary">{m.name}</td>
                    <td className="px-4 py-3">
                      <Pill tone={ROLE_TONE[m.roleName]}>{roleLabel(m.roleName)}</Pill>
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex justify-end gap-2">
                        <Button
                          size="sm"
                          variant="ghost"
                          aria-label={`Ubah ${m.username}`}
                          onClick={() => {
                            save.reset();
                            setRoleId(m.roleId);
                            setEditing(m);
                          }}
                        >
                          Ubah
                        </Button>
                        <Button
                          size="sm"
                          variant="ghost"
                          className="text-danger"
                          aria-label={`Hapus ${m.username}`}
                          onClick={() => {
                            save.reset();
                            setRemoving(m);
                          }}
                        >
                          Hapus
                        </Button>
                      </div>
                    </td>
                  </tr>
                ))}

                {rows?.length === 0 && (
                  <tr>
                    <td colSpan={4} className="px-4 py-8 text-center text-ink-tertiary">
                      {staff.data?.length ? 'Tidak ada staf yang cocok.' : 'Belum ada staf di outlet ini.'}
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </Card>
        )}
      </div>

      <Dialog
        open={!!editing}
        onClose={close}
        blocking={save.isPending}
        closeButton={false}
        title="Ubah peran"
        footer={
          <div className="flex w-full flex-col gap-3">
            {saveError}
            <div className="flex gap-3">
              <Button
                className="flex-1"
                loading={save.isPending}
                disabled={roleId === editing?.roleId}
                onClick={() =>
                  editing && write(staff.data!.map((m) => (m.id === editing.id ? { ...m, roleId } : m)))
                }
              >
                Simpan
              </Button>
              <Button variant="outline" className="flex-1" onClick={close} disabled={save.isPending}>
                Batal
              </Button>
            </div>
          </div>
        }
      >
        <div className="flex flex-col gap-1">
          <p className="mb-3 text-sm text-ink-secondary">
            <span className="font-medium text-ink-primary">{editing?.name}</span> ({editing?.username})
          </p>
          <label htmlFor="staff-role" className="text-sm text-ink-secondary">
            Peran
          </label>
          <select
            id="staff-role"
            className={SELECT}
            value={roleId}
            onChange={(e) => setRoleId(e.target.value)}
          >
            {roles.data?.map((r) => (
              <option key={r.id} value={r.id}>
                {roleLabel(r.name)}
              </option>
            ))}
          </select>
        </div>
      </Dialog>

      <Dialog
        open={!!removing}
        onClose={close}
        blocking={save.isPending}
        closeButton={false}
        title="Hapus staf?"
        footer={
          <div className="flex w-full flex-col gap-3">
            {saveError}
            <div className="flex gap-3">
              <Button
                variant="danger"
                className="flex-1"
                loading={save.isPending}
                onClick={() => removing && write(staff.data!.filter((m) => m.id !== removing.id))}
              >
                Hapus
              </Button>
              <Button variant="outline" className="flex-1" onClick={close} disabled={save.isPending}>
                Batal
              </Button>
            </div>
          </div>
        }
      >
        <p className="text-sm text-ink-secondary">
          <span className="font-medium text-ink-primary">{removing?.name}</span> tidak lagi bekerja di{' '}
          {outlet?.name}. Akunnya tetap ada.
        </p>
      </Dialog>
    </>
  );
}
