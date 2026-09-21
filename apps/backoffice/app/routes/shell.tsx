import { Outlet as RouteOutlet } from 'react-router';
import { LoginForm } from '../components/login-form';
import { Shell } from '../components/shell';
import { useAuthStore } from '../stores/auth';

/**
 * The layout route every page sits under, and the one auth gate. `Outlet` is react-router's slot,
 * renamed on import — this codebase's `outlet` is a physical location.
 */
export default function ShellRoute() {
  const accessToken = useAuthStore((s) => s.accessToken);
  if (!accessToken) return <LoginForm />;

  return (
    <Shell>
      <RouteOutlet />
    </Shell>
  );
}
