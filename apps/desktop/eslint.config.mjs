import { config } from "@repo/eslint-config/react";

/** @type {import("eslint").Linter.Config[]} */
export default [
  ...config,
  // These are CommonJS build config (module.exports/require/__dirname), loaded by
  // Node directly (Tailwind CLI, postcss-load-config) rather than bundled — the
  // require() calls are the point, not something to route through ESM import.
  {
    files: ["tailwind.config.js", "src/renderer/postcss.config.js"],
    languageOptions: { sourceType: "commonjs", globals: { __dirname: "readonly" } },
    rules: { "@typescript-eslint/no-require-imports": "off" },
  },
];
