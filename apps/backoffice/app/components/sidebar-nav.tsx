import { useQuery } from '@tanstack/react-query';
import { NavLink } from 'react-router';
import { useTRPC } from '../trpc';

/**
 * The menu, grouped like the design. `permission` is the name `rbac.require` checks on the server —
 * gating here only hides a door the router still guards, so a stale permission list cannot grant
 * anything. Until the list loads, items that need a permission stay disabled.
 */
export const MENU = [
  {
    label: 'Manajemen',
    items: [
      // Scoped to the session's active outlet, not the whole deployment.
      { to: '/pengaturan', label: 'Pengaturan', permission: 'settings.manage' },
      // Every outlet: the list, and each one's own fields.
      { to: '/outlet', label: 'Outlet', permission: 'outlet.view_all' },
      // The active outlet's roster.
      { to: '/staf', label: 'Staf', permission: 'outlet.staff_assign' },
    ],
  },
] as const;

const ROW = 'flex h-10 w-full items-center border-b border-border-muted px-4 text-left text-sm';

/** Full-bleed rows: the group band and the item highlight both run edge to edge, so no padding here. */
export function SidebarNav() {
  const trpc = useTRPC();
  const me = useQuery(trpc.auth.me.queryOptions());
  const granted = (permission: string) => me.data?.permissions.includes(permission) ?? false;

  return (
    <nav className="min-h-0 flex-1 overflow-auto">
      {MENU.map((group) => (
        <div key={group.label}>
          <p className="bg-surface-canvas px-4 py-2 text-xs font-semibold uppercase tracking-wider text-ink-tertiary">
            {group.label}
          </p>
          <ul>
            {group.items.map(({ to, label, permission }) => (
              <li key={to}>
                {granted(permission) ? (
                  <NavLink
                    to={to}
                    className={({ isActive }) =>
                      `${ROW} transition-colors hover:bg-primary-lighter ${
                        isActive ? 'bg-primary-lighter font-medium text-primary' : 'text-ink-secondary'
                      }`
                    }
                  >
                    <span className="truncate">{label}</span>
                  </NavLink>
                ) : (
                  <span className={`${ROW} cursor-not-allowed text-ink-tertiary/50`}>
                    <span className="truncate">{label}</span>
                  </span>
                )}
              </li>
            ))}
          </ul>
        </div>
      ))}
    </nav>
  );
}
