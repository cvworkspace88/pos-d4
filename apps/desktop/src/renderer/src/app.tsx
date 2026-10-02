import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { Button } from '@repo/ui/button';
import { StateMessageLayout } from '@repo/ui/state-message-layout';
import { FloorPlan } from './components/floor-plan';
import { LoginForm } from './components/login-form';
import { OutletPicker } from './components/outlet-picker';
import { PageHeader } from './components/page-header';
import { Shell, signOut } from './components/shell';
import { SidebarNav, type MenuGroup } from './components/sidebar-nav';
import { useAuthStore } from './stores/auth';
import { useTRPC } from './trpc';

const MENU: MenuGroup[] = [
  { label: 'Operasional', items: [{ key: 'denah', label: 'Denah Meja', permission: 'table.view' }] },
];

function Page({ permissions }: { permissions: string[] }) {
  return (
    <>
      <PageHeader title="Denah Meja" />
      <div className="min-h-0 flex-1 overflow-auto p-6">
        <FloorPlan permissions={permissions} />
      </div>
    </>
  );
}

/** Lands on the first menu page this user may open, in sidebar order — the backoffice's `home.tsx`. */
function Home() {
  const trpc = useTRPC();
  const me = useQuery(trpc.auth.me.queryOptions());
  const [selected, setSelected] = useState<string>();

  const permissions = me.data?.permissions ?? [];
  const menu = MENU.map((group) => ({
    ...group,
    items: group.items.filter((item) => permissions.includes(item.permission)),
  })).filter((group) => group.items.length);
  const keys = menu.flatMap((group) => group.items.map((item) => item.key));
  const page = selected && keys.includes(selected) ? selected : keys[0];

  return (
    <Shell nav={<SidebarNav menu={menu} active={page} onSelect={setSelected} />}>
      {me.error ? (
        <div className="flex min-h-0 flex-1 items-center justify-center overflow-auto p-6">
          <StateMessageLayout tone="danger" title="Gagal memuat akun" description={me.error.message}>
            <Button size="sm" onClick={() => void me.refetch()}>
              Coba lagi
            </Button>
          </StateMessageLayout>
        </div>
      ) : !me.data ? null : page ? (
        <Page permissions={permissions} />
      ) : (
        <div className="flex min-h-0 flex-1 items-center justify-center overflow-auto p-6">
          <StateMessageLayout
            title="Belum ada menu untuk Anda"
            description="Akun Anda belum punya akses ke halaman mana pun. Minta pemilik outlet memberi akses."
          />
        </div>
      )}
    </Shell>
  );
}

export function App() {
  const { accessToken, outlet } = useAuthStore();
  if (!accessToken) return <LoginForm />;
  if (!outlet) return <OutletPicker onSignOut={signOut} />;
  return <Home />;
}
