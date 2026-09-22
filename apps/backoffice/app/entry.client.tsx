import * as Sentry from '@sentry/react-router';
import { startTransition, StrictMode } from 'react';
import { hydrateRoot } from 'react-dom/client';
import { HydratedRouter } from 'react-router/dom';

// Public DSN — safe behind VITE_, which is what makes it reach the bundle at all.
// Empty DSN disables the SDK, so a dev without .env just runs Sentry-free.
Sentry.init({
  dsn: import.meta.env.VITE_SENTRY_DSN,
  environment: import.meta.env.MODE,
  integrations: [Sentry.reactRouterTracingIntegration()],
  // Every navigation is a transaction; 100% is a quota bill on a backoffice nobody watches.
  tracesSampleRate: import.meta.env.PROD ? 0.1 : 1.0,
  // ponytail: tracePropagationTargets left at the SDK default (same origin). The API is a
  // different origin and carries no Sentry, so there is no trace to join yet — widen when it does.
});

startTransition(() => {
  hydrateRoot(
    document,
    <StrictMode>
      <HydratedRouter onError={Sentry.sentryOnError} />
    </StrictMode>,
  );
});
