# @repo/hooks

Renderer-agnostic React hooks shared by every client: `apps/backoffice`, `apps/desktop`,
`apps/mobile`, and `@repo/ui` itself. Source `.ts` is exported directly, one file per hook —
there is no build step.

This package exists separately from `@repo/ui` because mobile cannot consume that one: `@repo/ui`
is DOM-only and drags `@base-ui/react` and `lucide-react` along with it. Nothing here may import a
DOM or React Native primitive — a hook that needs one belongs in the app or in `@repo/ui`.

React is a peer dependency, so every consumer supplies its own.
