import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { Alert } from '@repo/ui/alert';
import { Button } from '@repo/ui/button';
import { Card } from '@repo/ui/card';
import { Tabs } from '@repo/ui/tabs';
import { PasswordField, TextField } from '@repo/ui/text-field';
import {
  BUNDLED_PORT,
  DEFAULT_DB,
  type DbMode,
  type PublicDb,
  type TestResult,
} from '../../../main/hub-rules';

const required = z.string().trim().min(1, 'Wajib diisi.');
const port = z
  .number({ error: 'Port harus angka.' })
  .int()
  .min(1, 'Port 1–65535.')
  .max(65535, 'Port 1–65535.');

const externalSchema = z.object({
  host: required,
  port,
  database: required,
  user: required,
  // Empty is valid: a Postgres with trust auth has no password.
  password: z.string(),
});

const bundledSchema = z.object({
  port,
  user: required,
  // initdb reads the password file's first line only.
  password: z
    .string()
    .min(8, 'Minimal 8 karakter.')
    .regex(/^[^\r\n]*$/, 'Tanpa baris baru.'),
});

function generatePassword(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(18));
  return btoa(String.fromCharCode(...bytes)).replace(/[+/=]/g, '');
}

/** Shared by both forms: one pending flag, and the last answer from main. */
function useOutcome() {
  const [result, setResult] = useState<TestResult & { tested?: boolean }>();
  const [pending, setPending] = useState(false);
  const submit = async (action: () => Promise<TestResult>, tested = false) => {
    setPending(true);
    try {
      // A successful save switches the gate to "starting"; only a test success needs a message.
      setResult({ ...(await action()), tested });
    } finally {
      setPending(false);
    }
  };
  return { result, pending, submit };
}

function Outcome({ result }: { result?: TestResult & { tested?: boolean } }) {
  if (result && !result.ok)
    return (
      <Alert variant="danger" role="alert" data-testid="hub-setup-error">
        {result.message}
      </Alert>
    );
  if (result?.ok && result.tested) return <Alert variant="success">Koneksi berhasil.</Alert>;
  return null;
}

/**
 * The Postgres shipped with the app. `db` is set when a saved bundled config stopped answering; `cluster`
 * when one already exists (reinstall, lost `hub.json`) — both need the original credentials, not new ones.
 */
function BundledForm({ db, cluster }: { db?: PublicDb; cluster: boolean }) {
  const { result, pending, submit } = useOutcome();
  const [generated] = useState(generatePassword);
  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<z.infer<typeof bundledSchema>>({
    resolver: zodResolver(bundledSchema),
    defaultValues: {
      port: db?.port ?? BUNDLED_PORT,
      user: db?.user ?? DEFAULT_DB.user,
      password: db || cluster ? '' : generated,
    },
  });

  return (
    <form
      className="flex flex-col gap-6"
      onSubmit={handleSubmit((values) => submit(() => window.hub.saveBundled(values)))}
    >
      <p className="text-sm text-ink-secondary">
        {db || cluster
          ? 'Database bawaan sudah ada di komputer ini. Isi user dan password yang dipakai saat pertama kali disiapkan; datanya tetap tersimpan.'
          : 'Aplikasi menyiapkan dan menjalankan database sendiri. Catat password ini untuk akses dukungan teknis.'}
      </p>
      <div className="flex flex-col gap-4">
        <TextField
          label="Port"
          type="number"
          inputMode="numeric"
          error={errors.port?.message}
          {...register('port', { valueAsNumber: true })}
        />
        <TextField label="User" autoComplete="off" error={errors.user?.message} {...register('user')} />
        <PasswordField
          label="Password"
          autoComplete="off"
          error={errors.password?.message}
          {...register('password')}
        />
      </div>
      <Outcome result={result} />
      <Button type="submit" disabled={pending}>
        {pending ? 'Menyiapkan database…' : 'Siapkan database'}
      </Button>
    </form>
  );
}

/** Docker or a manual install. Main retries the saved one every 5 s. */
function ExternalForm({ db }: { db?: PublicDb }) {
  const { result, pending, submit } = useOutcome();
  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<z.infer<typeof externalSchema>>({
    resolver: zodResolver(externalSchema),
    defaultValues: { ...DEFAULT_DB, ...db, password: '' },
  });

  return (
    <form
      className="flex flex-col gap-6"
      onSubmit={handleSubmit((values) => submit(() => window.hub.saveDb(values)))}
    >
      <div className="flex flex-col gap-4">
        <TextField label="Host" error={errors.host?.message} {...register('host')} />
        <TextField
          label="Port"
          type="number"
          inputMode="numeric"
          error={errors.port?.message}
          {...register('port', { valueAsNumber: true })}
        />
        <TextField label="Database" error={errors.database?.message} {...register('database')} />
        <TextField label="User" autoComplete="off" error={errors.user?.message} {...register('user')} />
        <PasswordField label="Password" autoComplete="off" {...register('password')} />
      </div>
      <Outcome result={result} />
      <div className="flex gap-3">
        <Button
          type="button"
          variant="outline"
          disabled={pending}
          onClick={handleSubmit((values) => submit(() => window.hub.testDb(values), true))}
        >
          Tes koneksi
        </Button>
        <Button type="submit" className="flex-1" disabled={pending}>
          {pending ? 'Menghubungkan…' : 'Simpan & hubungkan'}
        </Button>
      </div>
    </form>
  );
}

/**
 * First run, or a saved database that stopped answering (US-002). Offers the bundled database only when
 * this build ships Postgres binaries for this platform; a failing saved config reopens on its own mode.
 */
export function HubSetup({
  bundled,
  cluster,
  mode,
  db,
  error,
}: {
  bundled: boolean;
  cluster: boolean;
  mode?: DbMode;
  db?: PublicDb;
  error?: string;
}) {
  const [tab, setTab] = useState<DbMode>(bundled ? (mode ?? 'bundled') : 'external');

  return (
    <div className="flex min-h-screen items-center justify-center bg-surface-canvas p-6">
      <Card className="w-full max-w-md gap-6 p-8">
        <div className="flex flex-col gap-1">
          <h1 className="text-2xl font-bold text-ink-primary">Pengaturan database</h1>
          <p className="text-sm text-ink-secondary">
            {bundled
              ? 'Pakai database bawaan aplikasi, atau PostgreSQL instalasi manual.'
              : 'Database PostgreSQL di komputer ini, dari Docker atau instalasi manual.'}
          </p>
        </div>

        {error && (
          <Alert variant="danger" role="alert" data-testid="hub-setup-banner">
            <strong>Database tidak terhubung.</strong> {error} Mencoba lagi otomatis setiap 5 detik.
          </Alert>
        )}

        {bundled ? (
          <Tabs
            value={tab}
            onValueChange={(value) => setTab(value as DbMode)}
            items={[
              {
                value: 'bundled',
                label: 'Database bawaan (disarankan)',
                content: <BundledForm db={mode === 'bundled' ? db : undefined} cluster={cluster} />,
              },
              {
                value: 'external',
                label: 'Database eksternal',
                content: <ExternalForm db={mode === 'external' ? db : undefined} />,
              },
            ]}
          />
        ) : (
          <ExternalForm db={db} />
        )}
      </Card>
    </div>
  );
}
