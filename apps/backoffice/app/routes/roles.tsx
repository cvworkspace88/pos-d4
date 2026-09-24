import { useQuery } from '@tanstack/react-query';
import { Fragment } from 'react';
import { Button } from '@repo/ui/button';
import { Card } from '@repo/ui/card';
import { Skeleton } from '@repo/ui/skeleton';
import { StateMessageLayout } from '@repo/ui/state-message-layout';
import { PageHeader } from '../components/page-header';
import { roleLabel } from '../roles';
import { useTRPC } from '../trpc';

// Domains are permission prefixes, not copy. An unknown one shows as-is.
const DOMAIN_LABEL: Record<string, string> = {
  sales: 'Penjualan',
  payments: 'Pembayaran',
  order: 'Pesanan',
  table: 'Meja',
  reservation: 'Reservasi',
  product: 'Produk',
  inventory: 'Persediaan',
  outlet: 'Outlet',
  role: 'Peran',
  settings: 'Pengaturan',
};

const SWATCH: Record<string, string> = {
  owner: 'bg-pink-light',
  manager: 'bg-lavender-light',
  cashier: 'bg-success-light',
  waiter: 'bg-warning-lighter',
  inventory_staff: 'bg-teal-lighter',
  auditor: 'bg-teal-light',
};

function Cell({ granted }: { granted: boolean }) {
  return (
    <span
      className={`inline-block size-3.5 rounded-full ${granted ? 'bg-primary' : 'bg-pebble'}`}
      aria-label={granted ? 'Diizinkan' : 'Tidak ada akses'}
      role="img"
    />
  );
}

/** Every role against every permission. Read-only: the seed owns the built-in roles' grants. */
export default function RolesPage() {
  const trpc = useTRPC();
  const matrix = useQuery(trpc.role.matrix.queryOptions());
  const roles = matrix.data?.roles ?? [];
  const rowCount = matrix.data?.groups.reduce((n, g) => n + g.rows.length, 0) ?? 0;

  return (
    <>
      <PageHeader title="Peran & izin" />
      <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-auto p-6">
        {matrix.error && !matrix.data ? (
          <Card className="min-h-0 flex-1 items-center justify-center">
            <StateMessageLayout tone="danger" title="Gagal memuat peran" description={matrix.error.message}>
              <Button size="sm" onClick={() => void matrix.refetch()} disabled={matrix.isFetching}>
                {matrix.isFetching ? 'Memuat…' : 'Coba lagi'}
              </Button>
            </StateMessageLayout>
          </Card>
        ) : (
          <>
            <div className="grid shrink-0 grid-cols-[repeat(auto-fill,minmax(11rem,1fr))] gap-4">
              {matrix.isPending
                ? Array.from({ length: 5 }, (_, i) => <Skeleton key={i} className="h-28 rounded-2xl" />)
                : roles.map((r) => (
                    <Card key={r.id} className="!gap-3">
                      <span
                        className={`size-8 rounded-lg ${SWATCH[r.name] ?? 'bg-primary-lighter'}`}
                        aria-hidden
                      />
                      <div>
                        <p className="font-medium text-ink-primary">{roleLabel(r.name)}</p>
                        <p className="text-xs text-ink-tertiary">{r.permissionCount} izin</p>
                      </div>
                    </Card>
                  ))}
            </div>

            <Card className="min-h-0 flex-1 overflow-auto !gap-0 !p-0">
              <table className="w-full text-sm" aria-busy={matrix.isPending}>
                <thead className="sticky top-0 z-10 bg-surface text-left text-xs text-ink-tertiary">
                  <tr className="border-b border-border-subtle">
                    <th className="px-4 py-3 font-medium">Izin</th>
                    {roles.map((r) => (
                      <th key={r.id} className="px-4 py-3 text-center font-medium">
                        {roleLabel(r.name)}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {matrix.isPending &&
                    Array.from({ length: 8 }, (_, i) => (
                      <tr key={i}>
                        <td className="px-4 py-2.5" colSpan={6}>
                          <Skeleton className="h-4 w-2/3" />
                        </td>
                      </tr>
                    ))}

                  {matrix.data?.groups.map((g) => (
                    <Fragment key={g.domain}>
                      <tr className="bg-surface-canvas">
                        <th
                          colSpan={roles.length + 1}
                          scope="colgroup"
                          className="px-4 py-2 text-left text-xs font-semibold text-ink-secondary"
                        >
                          {DOMAIN_LABEL[g.domain] ?? g.domain}
                        </th>
                      </tr>
                      {g.rows.map((row) => (
                        <tr key={row.key} className="border-b border-border-muted last:border-0">
                          <th scope="row" className="px-4 py-2.5 text-left font-normal">
                            {/* The label is for people; the name is what code and support refer to. */}
                            <span className="block text-ink-primary">{row.description ?? row.key}</span>
                            <span className="block font-mono text-xs text-ink-tertiary">{row.key}</span>
                          </th>
                          {row.granted.map((granted, i) => (
                            <td key={roles[i]!.id} className="px-4 py-2.5 text-center">
                              <Cell granted={granted} />
                            </td>
                          ))}
                        </tr>
                      ))}
                    </Fragment>
                  ))}
                </tbody>
              </table>
            </Card>

            <div className="flex shrink-0 flex-wrap items-center gap-x-5 gap-y-2 text-xs text-ink-tertiary">
              <span className="flex items-center gap-2">
                <span aria-hidden>
                  <Cell granted />
                </span>{' '}
                Diizinkan
              </span>
              <span className="flex items-center gap-2">
                <span aria-hidden>
                  <Cell granted={false} />
                </span>{' '}
                Tidak ada akses
              </span>
              {matrix.data && <span className="ml-auto">{rowCount} izin</span>}
            </div>
          </>
        )}
      </div>
    </>
  );
}
