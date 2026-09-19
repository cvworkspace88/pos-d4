import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { FloorPlan } from './components/floor-plan';
import { LoginForm } from './components/login-form';
import { OutletPicker } from './components/outlet-picker';
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

/** Owner-only. The server enforces `settings.manage`; hiding the block is a courtesy, not a gate. */
function IdleTimeoutSetting() {
  const trpc = useTRPC();
  const queryClient = useQueryClient();
  const setting = useQuery(trpc.settings.get.queryOptions());
  const [minutes, setMinutes] = useState<string | null>(null);

  const update = useMutation(
    trpc.settings.update.mutationOptions({
      onSuccess: (data) => {
        queryClient.setQueryData(trpc.settings.get.queryKey(), data);
        setMinutes(null);
      },
    }),
  );

  if (!setting.data) return null;
  const value = minutes ?? String(Math.round(setting.data.idleTimeoutSeconds / 60));

  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        update.mutate({ idleTimeoutSeconds: Number(value) * 60 });
      }}
    >
      <h2>Tablets</h2>
      <label htmlFor="idle-minutes">Auto-lock after (minutes)</label>
      <input
        id="idle-minutes"
        type="number"
        min={1}
        max={60}
        value={value}
        onChange={(event) => setMinutes(event.target.value)}
      />
      <button type="submit" disabled={update.isPending || minutes === null}>
        {update.isPending ? 'Saving…' : 'Save'}
      </button>
      {update.error && <p role="alert">{update.error.message}</p>}
    </form>
  );
}

function Home() {
  const trpc = useTRPC();
  const me = useQuery(trpc.auth.me.queryOptions());
  const { outlet, startSwitch } = useAuthStore();

  return (
    <main>
      <h1>POS D4</h1>
      <p>
        {me.isPending ? 'Loading…' : (me.data?.name ?? me.error?.message)}
        {outlet && (
          <>
            {' · '}
            {outlet.name}{' '}
            <button type="button" onClick={startSwitch}>
              Ganti outlet
            </button>
          </>
        )}
      </p>
      <button onClick={signOut}>Sign out</button>
      {me.data?.permissions.includes('settings.manage') && <IdleTimeoutSetting />}
      {me.data?.permissions.includes('table.view') && <FloorPlan permissions={me.data.permissions} />}
    </main>
  );
}

export function App() {
  const { accessToken, outlet, outlets, switching } = useAuthStore();
  if (!accessToken) return <LoginForm />;
  if (outlets.length && (!outlet || switching)) return <OutletPicker onSignOut={signOut} />;
  return <Home />;
}
