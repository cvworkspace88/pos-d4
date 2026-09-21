import { useQuery } from '@tanstack/react-query';
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
      { key: 'settings', label: 'Pengaturan', permission: 'settings.manage' },
      // Every outlet: the list, and each one's own fields.
      { key: 'outlets', label: 'Outlet', permission: 'outlet.manage' },
    ],
  },
] as const;

export type MenuKey = (typeof MENU)[number]['items'][number]['key'];

/** Full-bleed rows: the group band and the item highlight both run edge to edge, so no padding here. */
export function SidebarNav({ active, onSelect }: { active: MenuKey; onSelect: (key: MenuKey) => void }) {
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
            {group.items.map(({ key, label, permission }) => (
              <li key={key}>
                <button
                  type="button"
                  disabled={!granted(permission)}
                  onClick={() => onSelect(key)}
                  className={`flex h-10 w-full items-center border-b border-border-muted px-4 text-left text-sm transition-colors enabled:hover:bg-primary-lighter disabled:cursor-not-allowed disabled:text-ink-tertiary/50 ${
                    active === key ? 'bg-primary-lighter font-medium text-primary' : 'text-ink-secondary'
                  }`}
                >
                  <span className="truncate">{label}</span>
                </button>
              </li>
            ))}
          </ul>
        </div>
      ))}
    </nav>
  );
}
