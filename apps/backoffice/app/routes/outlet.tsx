import { PageHeader } from '../components/page-header';

/** Every outlet: list, create, edit, deactivate. Not scoped to the active one. */
export default function OutletPage() {
  return (
    <>
      <PageHeader title="Outlet" />
      <div className="min-h-0 flex-1 overflow-auto p-6">
        <div className="h-full min-h-[60vh] rounded-xl border border-border-subtle bg-surface" />
      </div>
    </>
  );
}
