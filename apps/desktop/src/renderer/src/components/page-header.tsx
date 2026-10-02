export function PageHeader({ title, subtitle }: { title: string; subtitle?: string }) {
  return (
    <header className="flex h-16 shrink-0 items-center gap-2 border-b border-border-subtle bg-surface px-6">
      <h1 className="text-base font-semibold text-ink-primary">{title}</h1>
      {subtitle && <span className="truncate text-sm text-ink-tertiary">· {subtitle}</span>}
    </header>
  );
}
