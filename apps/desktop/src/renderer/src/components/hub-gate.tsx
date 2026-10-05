import { useEffect, useState, type ReactNode } from 'react';
import { Button } from '@repo/ui/button';
import { Card } from '@repo/ui/card';
import { StateMessageLayout } from '@repo/ui/state-message-layout';
import type { HubState } from '../../../main/hub-rules';
import { HubSetup } from './hub-setup';

const DB_CHECKS = (
  <ul className="mt-2 list-disc pl-5 text-left">
    <li>Docker Desktop berjalan (jika memakai Docker)</li>
    <li>Layanan PostgreSQL aktif (jika instalasi manual)</li>
  </ul>
);

/** Everything the gate shows instead of (or over) the app; null when the hub is ready. */
function HubScreen({ state }: { state: HubState | null }) {
  if (state?.status === 'ready') return null;

  if (state?.status === 'db-down') {
    return (
      <div className="flex min-h-screen items-center justify-center bg-black/50 p-6">
        <Card className="max-w-md p-2">
          <StateMessageLayout
            tone="danger"
            title="Database tidak terhubung"
            description={
              state.logPath ? (
                <>
                  Database bawaan sedang dimulai ulang. Jika tidak pulih, kirim log ini ke dukungan teknis:
                  <code className="mt-2 block break-all text-xs">{state.logPath}</code>
                </>
              ) : (
                <>Menunggu database kembali. Periksa: {DB_CHECKS}</>
              )
            }
          />
        </Card>
      </div>
    );
  }

  if (state?.status === 'setup')
    return (
      <HubSetup
        bundled={state.bundled}
        cluster={state.cluster}
        mode={state.mode}
        db={state.db}
        error={state.error}
      />
    );

  if (state?.status === 'crashed') {
    return (
      <div className="flex min-h-screen items-center justify-center bg-surface-canvas p-6">
        <StateMessageLayout
          tone="danger"
          title="Server berhenti berulang kali"
          description={
            <>
              Server lokal berhenti lebih dari 3 kali dalam 10 menit. Kirim file log ini ke dukungan teknis:
              <code className="mt-2 block break-all text-xs">{state.logPath}</code>
            </>
          }
        >
          <Button variant="outline" onClick={() => void window.hub.openLog()}>
            Buka log
          </Button>
          <Button onClick={() => void window.hub.restart()}>Mulai ulang</Button>
        </StateMessageLayout>
      </div>
    );
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-surface-canvas text-ink-secondary">
      Menyiapkan server…
    </div>
  );
}

/**
 * Renders by the hub supervisor's status (US-002). The app mounts the first time the local API is healthy
 * and then stays mounted: a lost database, an API restart, a crash or the setup form all show over it, so
 * an open order survives until the hub is back.
 */
export function HubGate({ children }: { children: ReactNode }) {
  const [state, setState] = useState<HubState | null>(null);
  const [mounted, setMounted] = useState(false);
  if (state?.status === 'ready' && !mounted) setMounted(true);

  useEffect(() => {
    const off = window.hub.onState(setState);
    // A push that lands before this resolves is newer; keep it.
    void window.hub.getState().then((initial) => setState((current) => current ?? initial));
    return off;
  }, []);

  if (!mounted) return <HubScreen state={state} />;

  const blocked = state?.status !== 'ready';
  return (
    <>
      {/* inert: no clicks or keys reach the app while the hub is down; its state is kept. */}
      <div className="contents" inert={blocked}>
        {children}
      </div>
      {blocked && (
        <div className="fixed inset-0 z-50 overflow-auto" role="alertdialog">
          <HubScreen state={state} />
        </div>
      )}
    </>
  );
}
