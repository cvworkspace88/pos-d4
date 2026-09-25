import { useQuery } from '@tanstack/react-query';
import { StateMessageLayout } from '@repo/ui/state-message-layout';
import { Navigate } from 'react-router';
import { MENU } from '../components/sidebar-nav';
import { useTRPC } from '../trpc';

/** No dashboard yet: land on the first menu page this user may open, in sidebar order. */
export default function Home() {
  const trpc = useTRPC();
  const me = useQuery(trpc.auth.me.queryOptions());
  if (me.error) throw me.error;
  if (!me.data) return null;

  const { permissions } = me.data;
  const first = MENU.flatMap((group) => group.items).find((item) => permissions.includes(item.permission));
  if (first) return <Navigate to={first.to} replace />;

  return (
    <div className="flex min-h-0 flex-1 items-center justify-center overflow-auto p-6">
      <StateMessageLayout
        title="Belum ada menu untuk Anda"
        description="Akun Anda belum punya akses ke halaman mana pun. Minta pemilik outlet memberi akses."
      />
    </div>
  );
}
