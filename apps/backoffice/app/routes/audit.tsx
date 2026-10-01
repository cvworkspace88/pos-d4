import { useInfiniteQuery, useQuery } from '@tanstack/react-query';
import { useVirtualizer } from '@tanstack/react-virtual';
import { ChevronDown, ChevronRight } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { Alert } from '@repo/ui/alert';
import { Button } from '@repo/ui/button';
import { Card } from '@repo/ui/card';
import { Pill } from '@repo/ui/pill';
import { Select } from '@repo/ui/select';
import { Skeleton } from '@repo/ui/skeleton';
import { StateMessageLayout } from '@repo/ui/state-message-layout';
import { TextField } from '@repo/ui/text-field';
import {
  MODULE_LABEL,
  actionLabel,
  formatValue,
  subjectOf,
  type AuditModule,
  type AuditRow,
} from '../audit-labels';
import { PageHeader } from '../components/page-header';
import { useAuthStore } from '../stores/auth';
import { useTRPC } from '../trpc';

/** `YYYY-MM-DD`, `days` before today on this browser's calendar. */
const daysAgo = (days: number) => new Date(Date.now() - days * 86_400_000).toLocaleDateString('en-CA');

const COLUMNS = 'grid grid-cols-[1.25rem_10rem_10rem_9rem_minmax(0,1fr)] items-center gap-3';

/** Who changed what at the active outlet (US-011). Read-only: the log cannot be edited. */
export default function AuditPage() {
  const trpc = useTRPC();
  const outlet = useAuthStore((s) => s.outlet);
  const outletId = outlet?.id ?? '';

  const [fromDate, setFromDate] = useState(() => daysAgo(6));
  const [toDate, setToDate] = useState(() => daysAgo(0));
  const [mod, setMod] = useState('');
  const [userId, setUserId] = useState('');
  const [open, setOpen] = useState<string | null>(null);

  const validRange = !!fromDate && !!toDate && fromDate <= toDate;
  const actors = useQuery(trpc.audit.actors.queryOptions({ outletId }, { enabled: !!outlet }));
  const log = useInfiniteQuery(
    trpc.audit.list.infiniteQueryOptions(
      {
        outletId,
        fromDate,
        toDate,
        module: (mod || undefined) as AuditModule | undefined,
        userId: userId || undefined,
      },
      { enabled: !!outlet && validRange, getNextPageParam: (page) => page.nextCursor ?? undefined },
    ),
  );
  const rows = log.data?.pages.flatMap((p) => p.rows) ?? [];

  const scrollRef = useRef<HTMLDivElement>(null);
  // TanStack Virtual returns a mutable instance the React Compiler cannot memoize; it re-renders itself.
  // eslint-disable-next-line react-hooks/incompatible-library
  const virtual = useVirtualizer({
    count: rows.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => 48,
    overscan: 10,
  });
  const items = virtual.getVirtualItems();

  // Infinite scroll: the next page loads once the last rendered row is within 10 of the end.
  const lastIndex = items.at(-1)?.index ?? -1;
  const { hasNextPage, isFetchingNextPage, fetchNextPage } = log;
  useEffect(() => {
    if (hasNextPage && !isFetchingNextPage && lastIndex >= rows.length - 10) void fetchNextPage();
  }, [hasNextPage, isFetchingNextPage, fetchNextPage, lastIndex, rows.length]);

  const failed = log.error && !log.data;

  return (
    <>
      <PageHeader title="Log Audit" subtitle={outlet?.name ?? 'Belum ada outlet aktif'} />
      <div className="flex min-h-0 flex-1 flex-col gap-4 p-6">
        <div className="flex flex-wrap items-end gap-3">
          <div className="w-44">
            <TextField
              type="date"
              label="Dari"
              value={fromDate}
              max={toDate}
              onChange={(e) => setFromDate(e.target.value)}
            />
          </div>
          <div className="w-44">
            <TextField
              type="date"
              label="Sampai"
              value={toDate}
              min={fromDate}
              onChange={(e) => setToDate(e.target.value)}
              error={validRange ? undefined : 'Tanggal akhir sebelum tanggal awal.'}
            />
          </div>
          <div className="w-52">
            <Select
              label="Modul"
              value={mod}
              onValueChange={setMod}
              items={[
                { value: '', label: 'Semua modul' },
                ...Object.entries(MODULE_LABEL).map(([value, label]) => ({ value, label })),
              ]}
            />
          </div>
          <div className="w-52">
            <Select
              label="Pengguna"
              value={userId}
              onValueChange={setUserId}
              items={[
                { value: '', label: 'Semua pengguna' },
                ...(actors.data?.map((a) => ({ value: a.id, label: a.name })) ?? []),
              ]}
            />
          </div>
        </div>

        {failed ? (
          <Card className="min-h-0 flex-1 items-center justify-center">
            <StateMessageLayout tone="danger" title="Gagal memuat log audit" description={log.error.message}>
              <Button size="sm" onClick={() => void log.refetch()} disabled={log.isFetching}>
                {log.isFetching ? 'Memuat…' : 'Coba lagi'}
              </Button>
            </StateMessageLayout>
          </Card>
        ) : (
          <Card className="min-h-0 flex-1 !gap-0 !p-0">
            {log.error && (
              <Alert variant="danger" role="alert" className="m-4">
                {log.error.message}
              </Alert>
            )}
            <div
              className={`${COLUMNS} border-b border-border-subtle px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider text-ink-tertiary`}
            >
              <span />
              <span>Waktu</span>
              <span>Pengguna</span>
              <span>Modul</span>
              <span>Aksi</span>
            </div>

            <div ref={scrollRef} className="min-h-0 flex-1 overflow-auto" aria-busy={log.isPending}>
              {log.isPending &&
                outlet &&
                validRange &&
                Array.from({ length: 6 }, (_, i) => (
                  <div key={i} className={`${COLUMNS} border-b border-border-muted px-4 py-3`}>
                    {[0, 70, 60, 50, 40].map((w, j) => (
                      <Skeleton key={j} className="h-4" style={{ width: `${w}%` }} />
                    ))}
                  </div>
                ))}

              {rows.length > 0 && (
                <div className="relative w-full" style={{ height: virtual.getTotalSize() }}>
                  {items.map((item) => {
                    const row = rows[item.index]!;
                    return (
                      <div
                        key={row.id}
                        data-index={item.index}
                        ref={virtual.measureElement}
                        className="absolute left-0 top-0 w-full border-b border-border-muted"
                        style={{ transform: `translateY(${item.start}px)` }}
                      >
                        <LogRow
                          row={row}
                          open={open === row.id}
                          onToggle={() => setOpen(open === row.id ? null : row.id)}
                        />
                      </div>
                    );
                  })}
                </div>
              )}

              {log.data && rows.length === 0 && (
                <p className="px-4 py-8 text-center text-sm text-ink-tertiary">
                  Tidak ada perubahan pada rentang ini.
                </p>
              )}
              {isFetchingNextPage && (
                <p className="px-4 py-3 text-center text-sm text-ink-tertiary">Memuat…</p>
              )}
            </div>
          </Card>
        )}
      </div>
    </>
  );
}

function LogRow({ row, open, onToggle }: { row: AuditRow; open: boolean; onToggle: () => void }) {
  const subject = subjectOf(row);
  const keys = [...new Set([...Object.keys(row.before ?? {}), ...Object.keys(row.after ?? {})])];
  const Chevron = open ? ChevronDown : ChevronRight;
  return (
    <>
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={open}
        className={`${COLUMNS} w-full px-4 py-3 text-left text-sm hover:bg-surface-light`}
      >
        <Chevron className="size-4 text-ink-tertiary" aria-hidden />
        <span className="text-ink-secondary">{new Date(row.createdAt).toLocaleString('id-ID')}</span>
        <span className="truncate text-ink-primary">
          {row.actorName}
          {row.approverName && <span className="text-ink-tertiary"> · disetujui {row.approverName}</span>}
        </span>
        <span>
          <Pill>{MODULE_LABEL[row.module]}</Pill>
        </span>
        <span className="truncate text-ink-primary">
          {actionLabel(row.action)}
          {subject && <span className="text-ink-tertiary"> · {subject}</span>}
        </span>
      </button>
      {open && (
        <div className="px-4 pb-4 pl-12">
          {row.reason && <p className="mb-2 text-sm text-ink-secondary">Alasan: {row.reason}</p>}
          <table className="w-full table-fixed text-sm">
            <thead className="text-left text-xs uppercase tracking-wider text-ink-tertiary">
              <tr>
                <th className="w-48 py-1 font-semibold">Kolom</th>
                <th className="py-1 font-semibold">Sebelum</th>
                <th className="py-1 font-semibold">Sesudah</th>
              </tr>
            </thead>
            <tbody>
              {keys.map((key) => (
                <tr key={key} className="align-top">
                  <td className="py-1 font-mono text-xs text-ink-secondary">{key}</td>
                  <td className="break-words py-1 text-ink-secondary">{formatValue(row.before?.[key])}</td>
                  <td className="break-words py-1 text-ink-primary">{formatValue(row.after?.[key])}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}
