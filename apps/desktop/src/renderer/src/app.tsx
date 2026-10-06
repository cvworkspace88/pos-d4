import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { Button } from '@repo/ui/button';
import { StateMessageLayout } from '@repo/ui/state-message-layout';
import { FloorPlan } from './components/floor-plan';
import { LoginForm } from './components/login-form';
import { ChangePinDialog } from './components/change-pin-dialog';
import { LockScreen } from './components/lock-screen';
import { OutletPicker } from './components/outlet-picker';
import { PageHeader } from './components/page-header';
import { Shell, signOut } from './components/shell';
import { SidebarNav, type MenuGroup } from './components/sidebar-nav';
import { SetupWizard } from './components/setup-wizard';
import { StaffPage } from './components/staff-page';
import { useAuthStore } from './stores/auth';
import { useTRPC } from './trpc';

const MENU: MenuGroup[] = [
  { label: 'Operasional', items: [{ key: 'denah', label: 'Denah Meja', permission: 'table.view' }] },
  // Same page as the backoffice's: on the hub so a manager on the floor can unblock a cashier (US-010).
  { label: 'Pengaturan', items: [{ key: 'staf', label: 'Staf', permission: 'outlet.staff_assign' }] },
];

function Page({ page, permissions }: { page: string; permissions: string[] }) {
  if (page === 'staf') return <StaffPage />;
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
        <Page page={page} permissions={permissions} />
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

/** Signed out: a hub with no outlet yet gets the first-run setup (US-088), anything else the login. */
function SignedOut() {
  const trpc = useTRPC();
  const status = useQuery(trpc.setup.status.queryOptions());
  if (status.error && !status.data)
    return (
      <div className="flex min-h-screen items-center justify-center bg-surface-canvas p-6">
        <StateMessageLayout tone="danger" title="Gagal menghubungi server" description={status.error.message}>
          <Button size="sm" onClick={() => void status.refetch()}>
            Coba lagi
          </Button>
        </StateMessageLayout>
      </div>
    );
  if (!status.data) return null;
  return status.data.needed ? <SetupWizard /> : <LoginForm />;
}

export function App() {
  const { user, accessToken, refreshToken, outlet, locked } = useAuthStore();
  // Before the token check: a parked desk has no access token but must not fall back to login.
  if (locked && refreshToken) return <LockScreen onSignOut={signOut} />;
  if (!accessToken) return <SignedOut />;
  // Right after the password login, as on the tablet: the server only takes a first PIN without the
  // password while that login is fresh.
  if (!user?.hasPin) return <ChangePinDialog open firstRun onClose={signOut} />;
  if (!outlet) return <OutletPicker onSignOut={signOut} />;
  return <Home />;
}
