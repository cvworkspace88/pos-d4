# @repo/ui

Web UI components shared by `apps/desktop` (Electron renderer) and `apps/backoffice` (Vite).
Source `.tsx` is exported directly — both consumers bundle it, so there is no build step.

Mobile does **not** consume this package. React Native has no DOM primitives; `apps/mobile`
keeps its own `components/ui` that mirrors these variants against `Pressable`/`Text`.

Styling comes from the `@repo/tailwind-config` preset. Any app using this package must include
`../../packages/ui/src/**/*.{js,ts,jsx,tsx}` in its Tailwind `content` globs, or the classes
these components emit get purged.
