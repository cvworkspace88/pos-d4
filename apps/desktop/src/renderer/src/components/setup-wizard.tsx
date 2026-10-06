import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Controller, useForm } from 'react-hook-form';
import { z } from 'zod';
import { Alert } from '@repo/ui/alert';
import { Button } from '@repo/ui/button';
import { Card } from '@repo/ui/card';
import { Select } from '@repo/ui/select';
import { PasswordField, TextField } from '@repo/ui/text-field';
import { useAuthStore } from '../stores/auth';
import { useTRPC } from '../trpc';
import { digitsOnly } from './change-pin-dialog';

const TIMEZONES = [
  { value: 'Asia/Jakarta', label: 'WIB (Asia/Jakarta)' },
  { value: 'Asia/Makassar', label: 'WITA (Asia/Makassar)' },
  { value: 'Asia/Jayapura', label: 'WIT (Asia/Jayapura)' },
];

const required = z.string().trim().min(1, 'Wajib diisi.');

// Mirrors setup.router.ts's input; the repeats never leave the client.
const schema = z
  .object({
    outletName: required.max(60, 'Maksimal 60 karakter.'),
    code: required
      .max(12, 'Maksimal 12 karakter.')
      .regex(/^[a-zA-Z0-9-]+$/, 'Hanya huruf, angka dan tanda hubung.'),
    address: z.string().trim().max(200, 'Maksimal 200 karakter.'),
    timezone: z.enum(['Asia/Jakarta', 'Asia/Makassar', 'Asia/Jayapura']),
    cutoff: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Format JJ:MM.'),
    name: z.string().trim().min(2, 'Minimal 2 karakter.').max(80, 'Maksimal 80 karakter.'),
    username: z.string().trim().min(3, 'Minimal 3 karakter.').max(32, 'Maksimal 32 karakter.'),
    password: z.string().min(8, 'Minimal 8 karakter.').max(128, 'Maksimal 128 karakter.'),
    confirmPassword: z.string(),
    pin: z.string().regex(/^\d{6}$/, 'Harus 6 digit.'),
    confirmPin: z.string(),
  })
  .refine((v) => v.confirmPassword === v.password, {
    path: ['confirmPassword'],
    message: 'Kata sandi tidak sama.',
  })
  .refine((v) => v.confirmPin === v.pin, { path: ['confirmPin'], message: 'PIN tidak sama.' });

type FormValues = z.infer<typeof schema>;

const EMPTY: FormValues = {
  outletName: '',
  code: '',
  address: '',
  timezone: 'Asia/Jakarta',
  cutoff: '04:00',
  name: '',
  username: '',
  password: '',
  confirmPassword: '',
  pin: '',
  confirmPin: '',
};

/**
 * First run of a hub with no outlet (US-088): the first outlet and its owner, then straight in.
 * No licence check. Cloud sync is enabled later in the sync service (US-053), never by coming back here.
 */
export function SetupWizard() {
  const trpc = useTRPC();
  const queryClient = useQueryClient();
  const setSession = useAuthStore((s) => s.setSession);
  const statusKey = trpc.setup.status.queryKey();

  const {
    register,
    control,
    handleSubmit,
    formState: { errors },
  } = useForm<FormValues>({ resolver: zodResolver(schema), defaultValues: EMPTY });

  // Any refusal may mean the hub got set up meanwhile (PRECONDITION_FAILED): re-ask, and the login
  // form takes over if so.
  const setup = useMutation(
    trpc.setup.run.mutationOptions({
      onError: () => void queryClient.invalidateQueries({ queryKey: statusKey }),
    }),
  );
  const login = useMutation(trpc.auth.login.mutationOptions({ onSuccess: setSession }));

  const submit = async (v: FormValues) => {
    await setup.mutateAsync({
      outlet: {
        name: v.outletName,
        code: v.code,
        address: v.address || undefined,
        timezone: v.timezone,
        businessDayCutoff: v.cutoff,
      },
      owner: { name: v.name, username: v.username, password: v.password, pin: v.pin },
    });
    try {
      await login.mutateAsync({ username: v.username, password: v.password });
    } finally {
      // Set up either way. If the sign-in failed, the login form is the way in.
      queryClient.setQueryData(statusKey, { needed: false });
    }
  };

  const error = setup.error ?? login.error;
  const pending = setup.isPending || login.isPending;

  return (
    <div className="flex min-h-screen items-center justify-center overflow-auto bg-surface-canvas p-6">
      <form
        className="w-full max-w-2xl"
        // Rejections render in the alert below; an unhandled one would crash the renderer.
        onSubmit={handleSubmit((v) => submit(v).catch(() => undefined))}
      >
        <Card className="gap-6 p-8">
          <div className="flex flex-col gap-1">
            <h1 className="text-2xl font-bold text-ink-primary">Siapkan outlet</h1>
            <p className="text-sm text-ink-secondary">
              Isi sekali saja. Setelah ini Anda langsung masuk sebagai pemilik.
            </p>
          </div>

          <fieldset className="grid gap-4 sm:grid-cols-2">
            <legend className="mb-2 text-sm font-semibold text-ink-primary">Outlet</legend>
            <TextField label="Nama outlet" error={errors.outletName?.message} {...register('outletName')} />
            <TextField
              label="Kode outlet"
              helperText="Dicetak di struk, mis. KS1."
              error={errors.code?.message}
              {...register('code')}
            />
            <TextField
              label="Alamat"
              className="sm:col-span-2"
              error={errors.address?.message}
              {...register('address')}
            />
            <Controller
              control={control}
              name="timezone"
              render={({ field }) => (
                <Select
                  label="Zona waktu"
                  items={TIMEZONES}
                  value={field.value}
                  onValueChange={field.onChange}
                  error={errors.timezone?.message}
                />
              )}
            />
            <TextField
              label="Pergantian hari bisnis"
              type="time"
              helperText="Penjualan sebelum jam ini masuk ke tanggal kemarin."
              error={errors.cutoff?.message}
              {...register('cutoff')}
            />
          </fieldset>

          <fieldset className="grid gap-4 sm:grid-cols-2">
            <legend className="mb-2 text-sm font-semibold text-ink-primary">Pemilik</legend>
            <TextField label="Nama" error={errors.name?.message} {...register('name')} />
            <TextField
              label="Username"
              autoComplete="username"
              error={errors.username?.message}
              {...register('username')}
            />
            <PasswordField
              label="Kata sandi"
              autoComplete="new-password"
              error={errors.password?.message}
              {...register('password')}
            />
            <PasswordField
              label="Ulangi kata sandi"
              autoComplete="new-password"
              error={errors.confirmPassword?.message}
              {...register('confirmPassword')}
            />
            <PasswordField
              label="PIN (6 digit)"
              inputMode="numeric"
              maxLength={6}
              autoComplete="off"
              error={errors.pin?.message}
              {...digitsOnly(register('pin'))}
            />
            <PasswordField
              label="Ulangi PIN"
              inputMode="numeric"
              maxLength={6}
              autoComplete="off"
              error={errors.confirmPin?.message}
              {...digitsOnly(register('confirmPin'))}
            />
          </fieldset>

          <Alert variant="warning">
            Catat kata sandi ini. Tanpa akun cloud, kata sandi pemilik tidak bisa dipulihkan.
          </Alert>

          {error && (
            <Alert variant="danger" role="alert">
              {error.message}
            </Alert>
          )}

          <Button type="submit" size="lg" className="w-full" disabled={pending}>
            {pending ? 'Menyiapkan…' : 'Simpan dan masuk'}
          </Button>
        </Card>
      </form>
    </div>
  );
}
