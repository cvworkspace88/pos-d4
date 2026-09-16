import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation } from '@tanstack/react-query';
import { z } from 'zod';
import { Alert } from '@ui/alert';
import { Button } from '@ui/button';
import { Card } from '@ui/card';
import { PasswordField, TextField } from '@ui/text-field';
import { useTRPC } from '../trpc';
import { useAuthStore } from '../stores/auth';

const schema = z.object({
  username: z.string().min(3, 'Minimal 3 karakter.'),
  password: z.string().min(8, 'Minimal 8 karakter.'),
});

type FormValues = z.infer<typeof schema>;

export function LoginForm() {
  const trpc = useTRPC();
  const setSession = useAuthStore((s) => s.setSession);

  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: { username: '', password: '' },
  });

  const login = useMutation(trpc.auth.login.mutationOptions({ onSuccess: setSession }));

  return (
    <div className="flex min-h-screen items-center justify-center bg-surface-canvas p-6">
      {/* Capped so the card stays a card on a wide desktop instead of stretching edge to edge. */}
      <form
        className="w-full max-w-md"
        // Rejections render in the alert below; an unhandled one would crash the renderer.
        onSubmit={handleSubmit((values) => login.mutateAsync(values).catch(() => undefined))}
      >
        <Card className="gap-6 p-8">
          <div className="flex flex-col items-center gap-3">
            <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-primary text-3xl font-bold text-white">
              P
            </div>
            <h1 className="text-2xl font-bold text-ink-primary">Point of Sale</h1>
          </div>

          <div className="flex flex-col gap-4">
            <TextField
              data-testid="login-username"
              label="Email atau username"
              placeholder="andi.k@kafemelati.id"
              autoComplete="username"
              error={errors.username?.message}
              {...register('username')}
            />

            <PasswordField
              data-testid="login-password"
              label="Kata sandi"
              placeholder="••••••••"
              autoComplete="current-password"
              error={errors.password?.message}
              {...register('password')}
            />
          </div>

          {login.error && (
            <Alert data-testid="login-error" variant="danger" role="alert">
              <span className="mr-2 inline-block h-2 w-2 rounded-full bg-danger align-middle" aria-hidden />
              {login.error.message}
            </Alert>
          )}

          <Button type="submit" size="lg" className="w-full" disabled={login.isPending}>
            {login.isPending ? 'Memproses…' : 'Masuk'}
          </Button>
        </Card>
      </form>
    </div>
  );
}
