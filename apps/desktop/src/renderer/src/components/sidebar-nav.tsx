/**
 * The menu, grouped like the backoffice's. `permission` is the name `rbac.require` checks on the
 * server — gating here only hides a door the router still guards. The caller filters by it, so
 * every group passed in is already non-empty.
 *
 * No router in the desktop renderer: a page is a `key` the caller switches on.
 */
export interface MenuItem {
  key: string;
  label: string;
  permission: string;
}

export interface MenuGroup {
  label: string;
  items: MenuItem[];
}

const ROW = 'flex h-10 w-full items-center border-b border-border-muted px-4 text-left text-sm';

/** Full-bleed rows: the group band and the item highlight both run edge to edge, so no padding here. */
export function SidebarNav({
  menu,
  active,
  onSelect,
}: {
  menu: MenuGroup[];
  active: string | undefined;
  onSelect: (key: string) => void;
}) {
  return (
    <nav className="min-h-0 flex-1 overflow-auto">
      {menu.map((group) => (
        <div key={group.label}>
          <p className="bg-surface-canvas px-4 py-2 text-xs font-semibold uppercase tracking-wider text-ink-tertiary">
            {group.label}
          </p>
          <ul>
            {group.items.map(({ key, label }) => (
              <li key={key}>
                <button
                  type="button"
                  onClick={() => onSelect(key)}
                  aria-current={key === active ? 'page' : undefined}
                  className={`${ROW} transition-colors hover:bg-primary-lighter ${
                    key === active ? 'bg-primary-lighter font-medium text-primary' : 'text-ink-secondary'
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
