import { zodResolver } from '@hookform/resolvers/zod';
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Check, Plus, Search, TriangleAlertIcon } from 'lucide-react';
import { useState } from 'react';
import { Controller, useForm } from 'react-hook-form';
import { z } from 'zod';
import type { RouterOutputs } from '@repo/api-contract';
import { useDebounce } from '@repo/hooks/use-debounce';
import { useDialog } from '@repo/hooks/use-dialog';
import { Button } from '@repo/ui/button';
import { Dialog } from '@repo/ui/dialog';
import { Select, type SelectItem } from '@repo/ui/select';
import { Tabs } from '@repo/ui/tabs';
import { TextField } from '@repo/ui/text-field';
import { useTRPC } from '../trpc';

type Member = RouterOutputs['outlet']['staff'][number];

// Mirrors outlet.router.ts's addStaff input — the server still validates, this only spares a round trip.
const schema = z.object({
  name: z.string().trim().min(2, 'Minimal 2 karakter.').max(80),
  username: z.string().trim().min(3, 'Minimal 3 karakter.').max(32),
  password: z.string().min(8, 'Minimal 8 karakter.').max(128),
  pin: z.string().regex(/^(\d{6})?$/, 'PIN harus 6 digit.'),
  roleId: z.string().min(1, 'Pilih peran.'),
});

type NewStaff = z.infer<typeof schema>;

const EMPTY: NewStaff = { name: '', username: '', password: '', pin: '', roleId: '' };

interface AddStaffProps {
  outletId: string;
  /** The current roster: an existing account joins by `setStaff`, which takes the whole list. */
  roster: Member[];
  roleItems: SelectItem[];
  disabled?: boolean;
}

/** The `Tambah staf` button and its dialog: a brand-new account, or an existing one found by username. */
export function AddStaff({ outletId, roster, roleItems, disabled }: AddStaffProps) {
  const trpc = useTRPC();
  const queryClient = useQueryClient();
  const [tab, setTab] = useState<'new' | 'existing'>('new');

  const {
    register,
    control,
    handleSubmit,
    reset,
    formState: { errors },
  } = useForm<NewStaff>({ resolver: zodResolver(schema), defaultValues: EMPTY });

  // The existing-account tab: a debounced search, the pick, and its role.
  const [term, setTerm] = useState('');
  const debounced = useDebounce(term.trim());
  const [picked, setPicked] = useState<{ id: string; username: string } | null>(null);
  const [pickedRole, setPickedRole] = useState('');
  const found = useQuery(
    trpc.outlet.findUsers.queryOptions(
      { outletId, username: debounced },
      { enabled: !!debounced && !!outletId, placeholderData: keepPreviousData },
    ),
  );

  const onSaved = (next: Member[]) => {
    queryClient.setQueryData(trpc.outlet.staff.queryKey({ outletId }), next);
    dialog.close();
  };
  const create = useMutation(trpc.outlet.addStaff.mutationOptions({ onSuccess: onSaved }));
  // ponytail: last write wins against another admin's roster save, same as the page's setStaff.
  const assign = useMutation(trpc.outlet.setStaff.mutationOptions({ onSuccess: onSaved }));

  // Declared after the mutations on purpose, as on the outlet page: each only touches the other from an event.
  const dialog = useDialog(() => {
    reset(EMPTY);
    setTab('new');
    setTerm('');
    setPicked(null);
    setPickedRole('');
    create.reset();
    assign.reset();
  });

  const pending = create.isPending || assign.isPending;
  const error = tab === 'new' ? create.error : assign.error;

  const newForm = (
    <form
      id="staff-new-form"
      className="flex flex-col gap-4"
      // Rejections render in the footer; an unhandled one would crash the app.
      onSubmit={handleSubmit(({ pin, ...values }) =>
        create.mutateAsync({ outletId, ...values, pin: pin || undefined }).catch(() => undefined),
      )}
    >
      <TextField label="Nama" placeholder="Budi Santoso" error={errors.name?.message} {...register('name')} />
      <TextField
        label="Username"
        placeholder="budi"
        autoComplete="off"
        error={errors.username?.message}
        {...register('username')}
      />
      <TextField
        label="Password"
        autoComplete="off"
        error={errors.password?.message}
        {...register('password')}
      />
      <TextField
        label="PIN"
        error={errors.pin?.message}
        {...register('pin')}
        inputMode="numeric"
        pattern="[0-9]{6}"
        maxLength={6}
        placeholder="6 digit"
        autoComplete="off"
        helperText="PIN hanya digunakan untuk terminal kasir."
      />
      <Controller
        control={control}
        name="roleId"
        render={({ field, fieldState }) => (
          <Select
            label="Peran"
            placeholder="Pilih peran"
            value={field.value}
            onValueChange={field.onChange}
            error={fieldState.error?.message}
            items={roleItems}
          />
        )}
      />
    </form>
  );

  const existingForm = (
    <form
      id="staff-existing-form"
      className="flex flex-col gap-4"
      onSubmit={(e) => {
        e.preventDefault();
        if (!picked || !pickedRole) return;
        // Global-role lines (owner) are listed but are no membership, so they never go back.
        const staff = roster.filter((m) => !m.global).map((m) => ({ userId: m.id, roleId: m.roleId }));
        assign
          .mutateAsync({ outletId, staff: [...staff, { userId: picked.id, roleId: pickedRole }] })
          .catch(() => undefined);
      }}
    >
      <TextField
        type="search"
        label="Username"
        placeholder="Cari username"
        autoComplete="off"
        value={term}
        onChange={(e) => {
          setTerm(e.target.value);
          setPicked(null);
        }}
        adornment={<Search className="size-4 shrink-0 text-ink-tertiary" aria-hidden />}
      />

      {debounced && (
        <ul
          aria-label="Hasil pencarian"
          aria-busy={found.isFetching}
          className="flex max-h-48 flex-col overflow-auto rounded-lg border border-border-subtle"
        >
          {found.data?.map((u) => {
            const selected = picked?.id === u.id;
            return (
              <li key={u.id} className="border-b border-border-muted last:border-0">
                <button
                  type="button"
                  aria-pressed={selected}
                  onClick={() => setPicked(u)}
                  className={`flex w-full items-center justify-between px-3 py-2 text-left text-sm hover:bg-primary-lighter ${selected ? 'bg-primary-lighter' : ''}`}
                >
                  <span>
                    <span className="font-medium text-ink-primary">{u.username}</span>{' '}
                    <span className="text-ink-secondary">{u.name}</span>
                  </span>
                  {selected && <Check className="size-4 text-primary" aria-hidden />}
                </button>
              </li>
            );
          })}
          {found.data?.length === 0 && (
            <li className="px-3 py-2 text-sm text-ink-tertiary">
              Tidak ada user yang cocok, atau sudah bekerja di outlet ini.
            </li>
          )}
          {found.error && <li className="px-3 py-2 text-sm text-danger">{found.error.message}</li>}
        </ul>
      )}

      <Select
        label="Peran"
        placeholder="Pilih peran"
        value={pickedRole}
        onValueChange={setPickedRole}
        items={roleItems}
      />
    </form>
  );

  return (
    <>
      <Button size="sm" className="ml-auto" onClick={dialog.open} disabled={disabled}>
        <Plus className="mr-1 size-4" aria-hidden />
        Tambah staf
      </Button>

      <Dialog
        open={dialog.isOpen}
        onClose={dialog.close}
        // A stray click outside must not throw away a half-typed form; Batal is the way out.
        blocking
        closeButton={false}
        title="Tambah staf"
        footer={
          <div className="flex w-full flex-col gap-3">
            {error && (
              <div className="text-danger text-sm flex items-center flex-row gap-1">
                <TriangleAlertIcon className="size-4" /> {error.message}
              </div>
            )}
            <div className="flex gap-3">
              <Button
                type="submit"
                form={tab === 'new' ? 'staff-new-form' : 'staff-existing-form'}
                className="flex-1"
                loading={pending}
                disabled={tab === 'existing' && (!picked || !pickedRole)}
              >
                Simpan
              </Button>
              <Button variant="outline" className="flex-1" onClick={dialog.close} disabled={pending}>
                Batal
              </Button>
            </div>
          </div>
        }
      >
        <Tabs
          value={tab}
          onValueChange={(next) => setTab(next as 'new' | 'existing')}
          items={[
            { value: 'new', label: 'User baru', content: newForm, disabled: pending },
            { value: 'existing', label: 'Cari username', content: existingForm, disabled: pending },
          ]}
        />
      </Dialog>
    </>
  );
}
