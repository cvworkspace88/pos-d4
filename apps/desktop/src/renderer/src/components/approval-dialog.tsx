import { useQuery } from '@tanstack/react-query';
import { useState, type FormEvent } from 'react';
import { useTRPC } from '../trpc';
import type { ApprovalControl } from '@repo/hooks/use-approval';

/** "Minta akses": a manager picks their name and types their PIN on this screen (US-010). */
export function ApprovalDialog({ approval }: { approval: ApprovalControl }) {
  const trpc = useTRPC();
  const open = approval.pending !== null;
  const approvers = useQuery({
    ...trpc.approval.approvers.queryOptions({ permission: approval.permission }),
    enabled: open,
  });
  const [approverUserId, setApprover] = useState('');
  const [pin, setPin] = useState('');
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  if (!open) return null;

  const close = () => {
    setApprover('');
    setPin('');
    setReason('');
    setError(null);
    approval.close();
  };

  const onSubmit = async (event: FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await approval.submit({ approverUserId, pin, reason: reason.trim() || undefined });
      close();
    } catch (caught) {
      setPin('');
      setError((caught as Error).message); // the server's text, "Sisa N percobaan" included
    } finally {
      setBusy(false);
    }
  };

  const list = approvers.data ?? [];

  return (
    <dialog open>
      <form onSubmit={onSubmit}>
        <h3>Minta akses</h3>
        {approvers.isSuccess && list.length === 0 ? (
          <p>Tidak ada penyetuju dengan PIN di outlet ini.</p>
        ) : (
          <>
            <label htmlFor="approval-approver">Penyetuju</label>
            <select
              id="approval-approver"
              required
              value={approverUserId}
              onChange={(event) => setApprover(event.target.value)}
            >
              <option value="" disabled>
                Pilih penyetuju
              </option>
              {list.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.name}
                </option>
              ))}
            </select>

            <label htmlFor="approval-pin">PIN</label>
            <input
              id="approval-pin"
              type="password"
              inputMode="numeric"
              autoComplete="off"
              maxLength={6}
              required
              value={pin}
              onChange={(event) => setPin(event.target.value.replace(/\D/g, ''))}
            />

            <label htmlFor="approval-reason">Alasan (opsional)</label>
            <input
              id="approval-reason"
              type="text"
              maxLength={200}
              value={reason}
              onChange={(event) => setReason(event.target.value)}
            />

            <button type="submit" disabled={busy || !approverUserId || pin.length !== 6}>
              Setujui
            </button>
          </>
        )}
        {approvers.error && <p role="alert">{approvers.error.message}</p>}
        {error && <p role="alert">{error}</p>}
        <button type="button" onClick={close}>
          Tutup
        </button>
      </form>
    </dialog>
  );
}
