import type { Config } from '@react-router/dev/config';
import { sentryOnBuildEnd } from '@sentry/react-router';
import { loadEnv } from 'vite';

// SPA, not SSR: the session lives in localStorage and the tRPC client is created at module scope
// against the API origin — neither exists on a server render.
const config: Config = {
  ssr: false,
  // Upload half of the source-map setup; the vite.config.ts plugin is the other half and neither
  // works alone. Off without a token so a plain `pnpm build` needs no Sentry account.
  buildEnd: loadEnv('production', process.cwd(), '').SENTRY_AUTH_TOKEN ? sentryOnBuildEnd : undefined,
};

export default config;
