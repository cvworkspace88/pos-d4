import { useState } from 'react';
import { LoginForm } from './components/login-form';
import { Shell } from './components/shell';
import { MENU, type MenuKey } from './components/sidebar-nav';
import { useAuthStore } from './stores/auth';

const titleOf = (key: MenuKey) => MENU.flatMap((g) => g.items).find((i) => i.key === key)?.label ?? '';

function Home() {
  const [active, setActive] = useState<MenuKey>('settings');

  return (
    <Shell active={active} onSelect={setActive}>
      <header className="flex h-16 shrink-0 items-center gap-2 border-b border-border-subtle bg-surface px-6">
        <h1 className="text-base font-semibold text-ink-primary">{titleOf(active)}</h1>
      </header>
      <div className="min-h-0 flex-1 overflow-auto p-6">
        <div className="h-full min-h-[60vh] rounded-xl border border-border-subtle bg-surface" />
      </div>
    </Shell>
  );
}

export default function App() {
  const accessToken = useAuthStore((s) => s.accessToken);
  return accessToken ? <Home /> : <LoginForm />;
}
