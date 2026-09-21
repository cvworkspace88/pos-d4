import { PageHeader } from '../components/page-header';
import { useAuthStore } from '../stores/auth';

/** Settings for the session's active outlet — the sidebar switcher decides which one. */
export default function SettingsPage() {
  const outlet = useAuthStore((s) => s.outlet);

  return (
    <>
      <PageHeader title="Pengaturan" subtitle={outlet?.name ?? 'Belum ada outlet aktif'} />
      <div className="min-h-0 flex-1 overflow-auto p-6">
        <div className="h-full min-h-[60vh] rounded-xl border border-border-subtle bg-surface" />
      </div>
    </>
  );
}
