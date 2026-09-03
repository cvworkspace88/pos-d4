import { useQuery } from '@tanstack/react-query';
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
    <main>
      <h1>POS D4</h1>
      <p>{me.isPending ? 'Loading…' : (me.data?.name ?? me.error?.message)}</p>
      <button onClick={signOut}>Sign out</button>
    </main>
  );
}

export function App() {
  const accessToken = useAuthStore((s) => s.accessToken);
  return accessToken ? <Home /> : <LoginForm />;
}
