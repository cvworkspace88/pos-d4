import { useQuery } from '@tanstack/react-query';
import { Button } from '@repo/ui/button';
import { Card } from '@repo/ui/card';
import { LoginForm } from './components/login-form';
import { useAuthStore } from './stores/auth';
import { trpcClient, useTRPC } from './trpc';

/**
 * Local state goes first, so a slow or failed call can never trap the user in a signed-in shell.
 * The server call is fire-and-forget: without it the refresh token stays valid for its full 30 days.
 */
function signOut() {
  const { refreshToken, clear } = useAuthStore.getState();
  clear();
  if (refreshToken) void trpcClient.auth.logout.mutate({ refreshToken }).catch(() => undefined);
}

function Home() {
  const trpc = useTRPC();
  const me = useQuery(trpc.auth.me.queryOptions());

  return (
    <main className="flex min-h-screen items-center justify-center p-8">
      <Card className="flex w-full max-w-sm flex-col gap-4">
        <h1 className="text-lg font-semibold text-ink-primary">Backoffice</h1>
        <p className="text-sm text-ink-secondary">
          {me.isPending ? 'Loading…' : (me.data?.name ?? me.error?.message)}
        </p>
        <Button onClick={signOut}>Keluar</Button>
      </Card>
    </main>
  );
}

export default function App() {
  const accessToken = useAuthStore((s) => s.accessToken);
  console.log('accessToken', accessToken);
  return accessToken ? <Home /> : <LoginForm />;
}
