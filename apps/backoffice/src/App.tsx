import { LoginForm } from './components/login-form';
import { Shell } from './components/shell';
import { useAuthStore } from './stores/auth';

function Home() {
  return (
    <Shell>
      <header className="flex h-16 shrink-0 items-center gap-2 border-b border-border-subtle bg-surface px-6">
        <h1 className="text-base font-semibold text-ink-primary">Dashboard</h1>
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
