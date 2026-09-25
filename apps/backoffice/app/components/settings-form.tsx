import { z } from 'zod';
import { Alert } from '@repo/ui/alert';
import { Button } from '@repo/ui/button';

// Shared by the two settings pages: Pengaturan Outlet and Pengaturan Aplikasi.

/** A save button with the server's refusal above it and a quiet "saved" beside it. */
export function SaveBar({
  pending,
  dirty,
  saved,
  error,
}: {
  pending: boolean;
  /** Nothing to save until a field changes. */
  dirty: boolean;
  saved: boolean;
  error?: string;
}) {
  return (
    <div className="flex flex-col gap-3">
      {error && (
        <Alert variant="danger" role="alert">
          {error}
        </Alert>
      )}
      <div className="flex items-center justify-end gap-3">
        <span role="status" className="text-sm text-success">
          {saved && 'Tersimpan'}
        </span>
        <Button type="submit" loading={pending} disabled={!dirty}>
          Simpan
        </Button>
      </div>
    </div>
  );
}

// A percentage with at most two decimals, 0–100. Stored as basis points: 10.5% → 1050.
export const percent = z
  .string()
  .trim()
  .regex(/^\d{1,3}([.,]\d{1,2})?$/, 'Angka 0–100, maksimal 2 desimal.')
  .refine((s) => Number(s.replace(',', '.')) <= 100, 'Maksimal 100%.');

export const toBp = (s: string) => Math.round(Number(s.replace(',', '.')) * 100);
export const toPercent = (bp: number) => String(bp / 100);
