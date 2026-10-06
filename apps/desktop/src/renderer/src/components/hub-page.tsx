import { useQuery } from '@tanstack/react-query';
import QRCode from 'react-qr-code';
import { encodeHubQr } from '@repo/api-contract';
import { Button } from '@repo/ui/button';
import { Card } from '@repo/ui/card';
import { StateMessageLayout } from '@repo/ui/state-message-layout';
import { useTRPC } from '../trpc';
import { PageHeader } from './page-header';

/**
 * What a tablet needs to pair with this desktop (US-003): scan the code, or type the address. The same
 * facts the hub advertises over mDNS, read from `hub.info` so the page and the advert never disagree.
 */
export function HubPage() {
  const trpc = useTRPC();
  const info = useQuery(trpc.hub.info.queryOptions());

  const body = () => {
    if (info.error)
      return (
        <StateMessageLayout
          tone="danger"
          title="Gagal memuat info hub"
          description="Server lokal tidak menjawab. Coba lagi; jika tetap gagal, mulai ulang aplikasi."
        >
          <Button size="sm" onClick={() => void info.refetch()}>
            Coba lagi
          </Button>
        </StateMessageLayout>
      );
    if (!info.data) return null;
    const { outlet, port, addresses } = info.data;
    if (!outlet || addresses.length === 0)
      return (
        <StateMessageLayout
          title="Komputer ini belum terhubung ke jaringan"
          description="Sambungkan ke Wi-Fi atau LAN outlet, lalu coba lagi."
        >
          <Button size="sm" onClick={() => void info.refetch()}>
            Coba lagi
          </Button>
        </StateMessageLayout>
      );
    // ponytail: several network cards → the QR carries the first; the others are listed for typing in.
    const host = addresses[0]!;
    return (
      <div className="flex flex-wrap items-start gap-8">
        <div className="rounded-2xl bg-white p-4">
          <QRCode value={encodeHubQr({ host, port, outletId: outlet.id })} size={220} />
        </div>
        <dl className="grid grid-cols-[auto_1fr] gap-x-6 gap-y-3 text-sm">
          <dt className="text-ink-secondary">Outlet</dt>
          <dd className="font-semibold text-ink-primary">{outlet.name}</dd>
          <dt className="text-ink-secondary">Alamat IP</dt>
          <dd className="font-mono text-ink-primary">{addresses.join(', ')}</dd>
          <dt className="text-ink-secondary">Port</dt>
          <dd className="font-mono text-ink-primary">{port}</dd>
          <dd className="col-span-2 max-w-sm text-ink-secondary">
            Di tablet: buka aplikasi, pilih hub ini dari daftar, atau ketuk “Pindai kode QR” dan arahkan ke
            kode ini.
          </dd>
        </dl>
      </div>
    );
  };

  return (
    <>
      <PageHeader title="Perangkat" />
      <div className="min-h-0 flex-1 overflow-auto p-6">
        <Card className="p-6">{body()}</Card>
      </div>
    </>
  );
}
