import { reactRouter } from '@react-router/dev/vite';
import { sentryReactRouter } from '@sentry/react-router';
import { defineConfig, loadEnv } from 'vite';

// https://vite.dev/config/
export default defineConfig((config) => {
  // Vite only hands the app VITE_*; the Sentry plugin wants the bare names, from .env or from CI.
  // Pinned to 'production' so this reads exactly the files react-router.config.ts reads — the two
  // gates below have to agree, and a mode-specific token would otherwise turn on only one of them.
  const env = loadEnv('production', process.cwd(), '');

  return {
    plugins: [
      reactRouter(),
      // All or nothing on the token: the plugin turns on source map emission, and only the
      // buildEnd hook deletes the files again after uploading them. Half of that pair is worse
      // than neither — a tokenless build would leave the maps sitting in the public bundle.
      ...(env.SENTRY_AUTH_TOKEN
        ? [
            sentryReactRouter(
              {
                org: env.SENTRY_ORG,
                project: env.SENTRY_PROJECT,
                authToken: env.SENTRY_AUTH_TOKEN,
                sourcemaps: { filesToDeleteAfterUpload: ['./build/**/*.map'] },
              },
              config,
            ),
          ]
        : []),
    ],
    resolve: {
      tsconfigPaths: true,
    },
  };
});
