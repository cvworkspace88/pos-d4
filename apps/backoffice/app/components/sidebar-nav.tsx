import { useQuery } from '@tanstack/react-query';
import { NavLink } from 'react-router';
import { useTRPC } from '../trpc';

/**
 * The menu, grouped like the design. `permission` is the name `rbac.require` checks on the server —
 * gating here only hides a door the router still guards, so a stale permission list cannot grant
 * anything. An item without its permission is not shown at all, nor is a group left empty; until
 * the list loads, the menu is empty.
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
      {MENU.map((group) => {
        const items = group.items.filter(({ permission }) => granted(permission));
        if (!items.length) return null;
        return (
          <div key={group.label}>
            <p className="bg-surface-canvas px-4 py-2 text-xs font-semibold uppercase tracking-wider text-ink-tertiary">
              {group.label}
            </p>
            <ul>
              {items.map(({ to, label }) => (
                <li key={to}>
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
                </li>
              ))}
            </ul>
          </div>
        );
      })}
    </nav>
  );
}
