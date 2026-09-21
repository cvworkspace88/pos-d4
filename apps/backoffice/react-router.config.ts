import type { Config } from '@react-router/dev/config';

// SPA, not SSR: the session lives in localStorage and the tRPC client is created at module scope
// against the API origin — neither exists on a server render.
export default { ssr: false } satisfies Config;
