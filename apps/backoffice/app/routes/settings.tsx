import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { type Control, Controller, useForm } from 'react-hook-form';
import { z } from 'zod';
import type { RouterOutputs } from '@repo/api-contract';
import { Alert } from '@repo/ui/alert';
import { Button } from '@repo/ui/button';
import { Card } from '@repo/ui/card';
import { Checkbox } from '@repo/ui/checkbox';
import { Dialog } from '@repo/ui/dialog';
import { Select } from '@repo/ui/select';
import { Separator } from '@repo/ui/separator';
import { Skeleton } from '@repo/ui/skeleton';
import { StateMessageLayout } from '@repo/ui/state-message-layout';
import { Switch } from '@repo/ui/switch';
import { Tabs } from '@repo/ui/tabs';
import { TextField } from '@repo/ui/text-field';
import { useDialog } from '@repo/hooks/use-dialog';
import { PageHeader } from '../components/page-header';
import { SaveBar, percent, toBp, toPercent } from '../components/settings-form';
import { useAuthStore } from '../stores/auth';
import { useTRPC } from '../trpc';

type Outlet = RouterOutputs['outlet']['get'];

const TIMEZONES = [
  { value: 'Asia/Jakarta', label: 'WIB (Asia/Jakarta)' },
  { value: 'Asia/Makassar', label: 'WITA (Asia/Makassar)' },
  { value: 'Asia/Jayapura', label: 'WIT (Asia/Jayapura)' },
] as const;

const ORDER_TYPES = [
  { value: 'dine_in', label: 'Makan di tempat' },
  { value: 'takeaway', label: 'Bawa pulang' },
  { value: 'delivery', label: 'Delivery' },
] as const;

/** Settings for the session's active outlet — the sidebar switcher decides which one. */
export default function SettingsPage() {
  const trpc = useTRPC();
  const active = useAuthStore((s) => s.outlet);
  const outlet = useQuery({ ...trpc.outlet.get.queryOptions({ id: active?.id ?? '' }), enabled: !!active });

  return (
    <>
      <PageHeader
        title="Pengaturan Outlet"
        subtitle={outlet.data?.name ?? active?.name ?? 'Belum ada outlet aktif'}
      />
      <div className="min-h-0 flex-1 overflow-auto p-6">
        {!active ? null : outlet.isPending ? (
          <Card className="gap-4">
            {[40, 64, 64, 48].map((w) => (
              <Skeleton key={w} className="h-10" style={{ width: `${w}%` }} />
            ))}
          </Card>
        ) : outlet.error && !outlet.data ? (
          <Card className="items-center justify-center py-12">
            <StateMessageLayout
              tone="danger"
              title="Gagal memuat pengaturan outlet"
              description={outlet.error.message}
            >
              {/* A refusal will not change on retry — only a network or server failure might. */}
              {outlet.error.data?.code !== 'FORBIDDEN' && (
                <Button size="sm" onClick={() => void outlet.refetch()} disabled={outlet.isFetching}>
                  {outlet.isFetching ? 'Memuat…' : 'Coba lagi'}
                </Button>
              )}
            </StateMessageLayout>
          </Card>
        ) : (
          <Tabs
            // A sidebar switch remounts the forms, so no saved/error state carries across outlets.
            key={outlet.data.id}
            items={[
              { value: 'profile', label: 'Profil outlet', content: <ProfileForm outlet={outlet.data} /> },
              { value: 'charges', label: 'Pajak & layanan', content: <ChargesForm outlet={outlet.data} /> },
              { value: 'day', label: 'Hari bisnis', content: <BusinessDayForm outlet={outlet.data} /> },
            ]}
          />
        )}
      </div>
    </>
  );
}

/** Refreshes every outlet read after a save — this page's `get` and the outlet list. */
function useSaved() {
  const trpc = useTRPC();
  const queryClient = useQueryClient();
  return () => queryClient.invalidateQueries(trpc.outlet.pathFilter());
}

// Mirrors outlet.router.ts's update input — the server still validates.
const profileSchema = z.object({
  name: z.string().trim().min(1, 'Wajib diisi.').max(60),
  address: z.string().trim().max(200),
  city: z.string().trim().max(60),
  phone: z.string().trim().max(32),
  timezone: z.enum(['Asia/Jakarta', 'Asia/Makassar', 'Asia/Jayapura']),
});

type ProfileValues = z.infer<typeof profileSchema>;

const profileValues = (o: Outlet): ProfileValues => ({
  name: o.name,
  address: o.address ?? '',
  city: o.city ?? '',
  phone: o.phone ?? '',
  timezone: o.timezone,
});

function ProfileForm({ outlet }: { outlet: Outlet }) {
  const trpc = useTRPC();
  const saved = useSaved();
  // `values` follows the loaded outlet on every refetch, but a field the user is editing keeps what
  // they typed. A save then resets to what the server stored, which is what clears `isDirty`.
  const {
    register,
    control,
    handleSubmit,
    reset,
    formState: { errors, isDirty },
  } = useForm<ProfileValues>({
    resolver: zodResolver(profileSchema),
    values: profileValues(outlet),
    resetOptions: { keepDirtyValues: true },
  });

  const update = useMutation(trpc.outlet.update.mutationOptions({ onSuccess: saved }));

  return (
    <Card className="gap-4">
      {/* Outside the form: the code dialog's own submit would otherwise bubble through the React
          tree (portals included) and save this form too. */}
      <div className="sm:w-1/2 sm:pr-2">
        <CodeField outlet={outlet} />
      </div>
      <form
        className="flex flex-col gap-4"
        // Rejections render in the alert; an unhandled one would crash the app.
        onSubmit={handleSubmit((v) =>
          update
            .mutateAsync({
              id: outlet.id,
              name: v.name,
              // The server treats an omitted field as cleared, so blank must not travel as ''.
              address: v.address || undefined,
              city: v.city || undefined,
              phone: v.phone || undefined,
              timezone: v.timezone,
            })
            .then((stored) => reset(profileValues(stored)))
            .catch(() => undefined),
        )}
      >
        <div className="grid gap-4 sm:grid-cols-2">
          <TextField label="Nama" error={errors.name?.message} {...register('name')} />
          <TextField label="Alamat" error={errors.address?.message} {...register('address')} />
          <TextField label="Kota" error={errors.city?.message} {...register('city')} />
          <TextField label="Telepon" error={errors.phone?.message} {...register('phone')} />
          <Controller
            control={control}
            name="timezone"
            render={({ field }) => (
              <Select
                label="Zona waktu"
                items={[...TIMEZONES]}
                value={field.value}
                onValueChange={field.onChange}
                error={errors.timezone?.message}
              />
            )}
          />
        </div>
        <SaveBar
          pending={update.isPending}
          dirty={isDirty}
          saved={update.isSuccess && !isDirty}
          error={update.error?.message}
        />
      </form>
    </Card>
  );
}

const codeSchema = z.object({
  code: z
    .string()
    .trim()
    .min(1, 'Wajib diisi.')
    .max(12)
    .regex(/^[a-zA-Z0-9-]+$/, 'Huruf, angka, dan tanda hubung saja.'),
});

/** The code is printed on receipts and keys terminal setup, so it changes through its own dialog. */
function CodeField({ outlet }: { outlet: Outlet }) {
  const trpc = useTRPC();
  const saved = useSaved();
  const {
    register,
    handleSubmit,
    reset,
    formState: { errors },
  } = useForm<z.infer<typeof codeSchema>>({
    resolver: zodResolver(codeSchema),
    values: { code: outlet.code },
  });

  const setCode = useMutation(
    trpc.outlet.setCode.mutationOptions({
      onSuccess: async () => {
        await saved();
        dialog.close();
      },
    }),
  );

  // Declared after `setCode`: the two reference each other, and both only run on an event.
  const dialog = useDialog(() => {
    reset({ code: outlet.code });
    setCode.reset();
  });

  return (
    <>
      <div className="flex items-end gap-2">
        <div className="flex-1">
          <TextField label="Kode" value={outlet.code} disabled readOnly />
        </div>
        <Button variant="outline" onClick={dialog.open}>
          Ubah kode
        </Button>
      </div>

      <Dialog
        open={dialog.isOpen}
        onClose={dialog.close}
        blocking={setCode.isPending}
        title="Ubah kode outlet"
        footer={
          <>
            <Button variant="ghost" onClick={dialog.close} disabled={setCode.isPending}>
              Batal
            </Button>
            <Button type="submit" form="outlet-code-form" loading={setCode.isPending}>
              Simpan
            </Button>
          </>
        }
      >
        <form
          id="outlet-code-form"
          className="flex flex-col gap-4"
          onSubmit={handleSubmit((v) =>
            setCode.mutateAsync({ id: outlet.id, code: v.code }).catch(() => undefined),
          )}
        >
          <TextField
            label="Kode"
            helperText="Tercetak di struk dan dipakai saat menyiapkan terminal."
            error={errors.code?.message}
            {...register('code')}
          />
          {setCode.error && (
            <Alert variant="danger" role="alert">
              {setCode.error.message}
            </Alert>
          )}
        </form>
      </Dialog>
    </>
  );
}

const digits = (s: string) => s.replace(/\D/g, '');

// Mirrors outlet.router.ts's setCharges input — the server still validates. Which tax a sale carries
// is the menu item's business, so every field here is always shown; NPWP and NPWPD may be blank.
const chargesSchema = z.object({
  // Typed as printed (dots, dash); only the digits travel.
  npwp: z
    .string()
    .trim()
    .refine((s) => [0, 15, 16].includes(digits(s).length), 'NPWP harus 15 atau 16 digit.'),
  ppnRate: percent,
  ppnInclusive: z.boolean(),
  npwpd: z.string().trim().max(30),
  pbjtLabel: z.string().trim().min(1, 'Wajib diisi.').max(30),
  pbjtRate: percent,
  pbjtInclusive: z.boolean(),
  serviceName: z.string().trim().min(1, 'Wajib diisi.').max(30),
  serviceRate: percent,
  servicePbjtTaxable: z.boolean(),
  serviceOrderTypes: z.array(z.enum(['dine_in', 'takeaway', 'delivery'])),
});

type ChargesValues = z.infer<typeof chargesSchema>;

const chargesValues = (o: Outlet): ChargesValues => ({
  npwp: o.npwp ?? '',
  ppnRate: toPercent(o.ppnRateBp),
  ppnInclusive: o.ppnInclusive,
  npwpd: o.npwpd ?? '',
  pbjtLabel: o.pbjtLabel,
  pbjtRate: toPercent(o.pbjtRateBp),
  pbjtInclusive: o.pbjtInclusive,
  serviceName: o.serviceName,
  serviceRate: toPercent(o.serviceRateBp),
  servicePbjtTaxable: o.servicePbjtTaxable,
  serviceOrderTypes: o.serviceOrderTypes,
});

/** A labelled switch bound to one of the form's boolean fields. */
function FormSwitch({
  control,
  name,
  label,
}: {
  control: Control<ChargesValues>;
  name: 'pbjtInclusive' | 'ppnInclusive' | 'servicePbjtTaxable';
  label: string;
}) {
  return (
    <Controller
      control={control}
      name={name}
      render={({ field }) => (
        <label className="flex items-center gap-3 text-sm text-ink-secondary">
          <Switch checked={field.value} onCheckedChange={field.onChange} />
          {label}
        </label>
      )}
    />
  );
}

function ChargesForm({ outlet }: { outlet: Outlet }) {
  const trpc = useTRPC();
  const saved = useSaved();
  const {
    register,
    control,
    handleSubmit,
    reset,
    formState: { errors, isDirty },
  } = useForm<ChargesValues>({
    resolver: zodResolver(chargesSchema),
    // Same as the profile form: a refetch never overwrites a field being edited.
    values: chargesValues(outlet),
    resetOptions: { keepDirtyValues: true },
  });

  const setCharges = useMutation(trpc.outlet.setCharges.mutationOptions({ onSuccess: saved }));

  return (
    <Card>
      <form
        className="flex flex-col gap-6"
        onSubmit={handleSubmit((v) =>
          setCharges
            .mutateAsync({
              id: outlet.id,
              // The server treats an omitted field as cleared, so blank must not travel as ''. Trimmed
              // here: the schema's trim only validates, it does not change what is submitted.
              npwp: digits(v.npwp) || undefined,
              ppnRateBp: toBp(v.ppnRate),
              ppnInclusive: v.ppnInclusive,
              npwpd: v.npwpd.trim() || undefined,
              pbjtLabel: v.pbjtLabel,
              pbjtRateBp: toBp(v.pbjtRate),
              pbjtInclusive: v.pbjtInclusive,
              serviceName: v.serviceName,
              serviceRateBp: toBp(v.serviceRate),
              servicePbjtTaxable: v.servicePbjtTaxable,
              serviceOrderTypes: v.serviceOrderTypes,
            })
            .then((stored) => reset(chargesValues(stored)))
            .catch(() => undefined),
        )}
      >
        <section className="flex flex-col gap-4">
          <h2 className="text-sm font-semibold text-ink-primary">PPN</h2>
          <div className="grid gap-4 sm:grid-cols-2">
            <TextField
              label="NPWP"
              inputMode="numeric"
              placeholder="0000 0000 0000 0000"
              error={errors.npwp?.message}
              {...register('npwp')}
            />
          </div>
          <div className="grid gap-4 sm:grid-cols-3">
            <TextField
              label="Tarif PPN efektif (%)"
              inputMode="decimal"
              error={errors.ppnRate?.message}
              {...register('ppnRate')}
            />
          </div>
          <FormSwitch
            control={control}
            name="ppnInclusive"
            label="Harga barang sudah termasuk PPN (inklusif)"
          />
        </section>

        <Separator />

        <section className="flex flex-col gap-4">
          <h2 className="text-sm font-semibold text-ink-primary">Pajak PBJT</h2>
          <div className="grid gap-4 sm:grid-cols-2">
            <TextField
              label="NPWPD"
              helperText="Nomor wajib pajak daerah, untuk laporan PBJT."
              error={errors.npwpd?.message}
              {...register('npwpd')}
            />
          </div>
          <div className="grid gap-4 sm:grid-cols-3">
            <TextField
              label="Nama pajak"
              placeholder="PBJT"
              helperText="Tercetak di struk. Contoh: PBJT, PB1, atau Pajak Restoran."
              error={errors.pbjtLabel?.message}
              {...register('pbjtLabel')}
            />
            <TextField
              label="Tarif pajak (%)"
              inputMode="decimal"
              error={errors.pbjtRate?.message}
              {...register('pbjtRate')}
            />
          </div>
          <FormSwitch
            control={control}
            name="pbjtInclusive"
            label="Harga menu sudah termasuk PBJT (inklusif)"
          />
        </section>

        <Separator />

        <section className="flex flex-col gap-4">
          <h2 className="text-sm font-semibold text-ink-primary">Biaya layanan</h2>
          <div className="grid gap-4 sm:grid-cols-3">
            <TextField
              label="Nama biaya layanan"
              placeholder="Biaya Layanan"
              helperText="Tercetak di struk. Contoh: Service, Biaya Layanan."
              error={errors.serviceName?.message}
              {...register('serviceName')}
            />
            <TextField
              label="Tarif biaya layanan (%)"
              inputMode="decimal"
              error={errors.serviceRate?.message}
              {...register('serviceRate')}
            />
          </div>
          <FormSwitch
            control={control}
            name="servicePbjtTaxable"
            label="Pajak dihitung atas biaya layanan (subtotal + biaya layanan)"
          />
          <Controller
            control={control}
            name="serviceOrderTypes"
            render={({ field }) => (
              <fieldset className="flex flex-col gap-2">
                <legend className="mb-2 text-sm text-ink-secondary">
                  Dikenakan pada pesanan (selalu ditambahkan di atas harga)
                </legend>
                {ORDER_TYPES.map((t) => (
                  <Checkbox
                    key={t.value}
                    label={t.label}
                    checked={field.value.includes(t.value)}
                    onCheckedChange={(on) =>
                      field.onChange(
                        // Kept in list order, so the saved value never depends on click order.
                        ORDER_TYPES.map((o) => o.value).filter((v) =>
                          v === t.value ? on : field.value.includes(v),
                        ),
                      )
                    }
                  />
                ))}
              </fieldset>
            )}
          />
        </section>

        <SaveBar
          pending={setCharges.isPending}
          dirty={isDirty}
          saved={setCharges.isSuccess && !isDirty}
          error={setCharges.error?.message}
        />
      </form>
    </Card>
  );
}

const hhmm = /^([01]\d|2[0-3]):[0-5]\d$/;

// Mirrors outlet.router.ts's setBusinessDay input — the server still validates.
const businessDaySchema = z.object({
  cutoff: z.string().regex(hhmm, 'Format JJ:MM.'),
  autoClose: z.string().refine((s) => s === '' || hhmm.test(s), 'Format JJ:MM.'),
});

type DayValues = z.infer<typeof businessDaySchema>;

const dayValues = (o: Outlet): DayValues => ({
  cutoff: o.businessDayCutoff,
  autoClose: o.businessDayAutoClose ?? '',
});

function BusinessDayForm({ outlet }: { outlet: Outlet }) {
  const trpc = useTRPC();
  const saved = useSaved();
  const {
    register,
    handleSubmit,
    reset,
    formState: { errors, isDirty },
  } = useForm<DayValues>({
    resolver: zodResolver(businessDaySchema),
    values: dayValues(outlet),
    resetOptions: { keepDirtyValues: true },
  });

  const setDay = useMutation(trpc.outlet.setBusinessDay.mutationOptions({ onSuccess: saved }));

  return (
    <Card>
      <form
        className="flex flex-col gap-4"
        onSubmit={handleSubmit((v) =>
          setDay
            .mutateAsync({
              id: outlet.id,
              businessDayCutoff: v.cutoff,
              // Omitted = cleared, so blank must not travel as ''.
              businessDayAutoClose: v.autoClose || undefined,
            })
            .then((stored) => reset(dayValues(stored)))
            .catch(() => undefined),
        )}
      >
        <div className="grid gap-4 sm:grid-cols-3">
          <TextField
            label="Pergantian hari bisnis"
            type="time"
            helperText="Penjualan sebelum jam ini masuk ke tanggal kemarin."
            error={errors.cutoff?.message}
            {...register('cutoff')}
          />
          <TextField
            label="Tutup hari otomatis"
            type="time"
            helperText="Kosongkan bila hari ditutup manual."
            error={errors.autoClose?.message}
            {...register('autoClose')}
          />
        </div>
        <SaveBar
          pending={setDay.isPending}
          dirty={isDirty}
          saved={setDay.isSuccess && !isDirty}
          error={setDay.error?.message}
        />
      </form>
    </Card>
  );
}
