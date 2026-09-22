import { Button } from '@repo/ui/button';
import { StateMessageLayout } from '@repo/ui/state-message-layout';
import { Outlet as RouteOutlet, useNavigate } from 'react-router';
import type { Route } from './+types/page-boundary';

/**
 * Pathless layout route that exists only to own the `ErrorBoundary` below — it adds no markup of
 * its own, so pages sit in the shell exactly as before.
 *
 * It must stay loader-free: react-router will not render a route's component without its loader
 * data, and this route's whole job is to render its children.
 */
export default function PageBoundaryRoute() {
  return <RouteOutlet />;
}

/**
 * Catches whatever any page under the shell throws, so no page needs its own boundary.
 *
 * A route's boundary renders *instead of that route's component*, and everything above it keeps
 * rendering — so this sits one level below `shell.tsx` on purpose. `Shell` is the parent here,
 * which means the sidebar, the outlet switcher and sign-out stay mounted and untouched while only
 * the page body becomes the failure state. Put this same export on `shell.tsx` and it would
 * replace the shell itself, sidebar included.
 *
 * ponytail: one generic message for every page. A page that needs copy this cannot know exports
 * its own `ErrorBoundary` — the nearer boundary wins, no wiring.
 */
export function ErrorBoundary({ error }: Route.ErrorBoundaryProps) {
  const navigate = useNavigate();
  const detail = import.meta.env.DEV && error instanceof Error ? error.message : undefined;

  return (
    <div className="flex min-h-0 flex-1 items-center justify-center overflow-auto p-6">
      <StateMessageLayout
        tone="danger"
        title="Gagal memuat halaman ini"
        description={
          detail ?? 'Sambungan ke server terputus saat memuat. Data yang tersimpan tidak terpengaruh.'
        }
      >
        <Button size="sm" onClick={() => window.location.reload()}>
          Coba lagi
        </Button>
        <Button variant="outline" size="sm" onClick={() => void navigate('/pengaturan')}>
          Kembali
        </Button>
      </StateMessageLayout>
    </div>
  );
}
