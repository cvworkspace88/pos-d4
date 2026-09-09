import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation } from '@tanstack/react-query';
import { z } from 'zod';
import { useTRPC } from '../trpc';
import { useAuthStore } from '../stores/auth';

const schema = z.object({
  username: z.string().min(3, 'At least 3 characters.'),
  password: z.string().min(8, 'At least 8 characters.'),
});

type FormValues = z.infer<typeof schema>;

export function LoginForm() {
  const trpc = useTRPC();
  const setSession = useAuthStore((s) => s.setSession);

  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<FormValues>({ resolver: zodResolver(schema) });

  const login = useMutation(
    trpc.auth.login.mutationOptions({
      onSuccess: setSession,
    }),
  );

  return (
    <form onSubmit={handleSubmit((values) => login.mutateAsync(values).catch(() => undefined))}>
      <div className="bg-surface-light text-ink-secondary border border-border">hehe</div>

      <h1>Sign in</h1>

      <label htmlFor="username">Username</label>
      <input id="username" type="text" autoComplete="username" {...register('username')} />
      {errors.username && <p role="alert">{errors.username.message}</p>}

      <label htmlFor="password">Password</label>
      <input id="password" type="password" autoComplete="current-password" {...register('password')} />
      {errors.password && <p role="alert">{errors.password.message}</p>}

      <button type="submit" disabled={isSubmitting || login.isPending}>
        {login.isPending ? 'Signing in…' : 'Sign in'}
      </button>

      {login.error && <p role="alert">{login.error.message}</p>}
    </form>
  );
}
