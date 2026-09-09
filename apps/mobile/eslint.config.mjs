import { config } from "@repo/eslint-config/react";

/** @type {import("eslint").Linter.Config[]} */
export default [
  ...config,
  { ignores: [".expo/**", "expo-env.d.ts"] },
  // These are CommonJS build config (module.exports/require/__dirname), loaded by
  // Node directly (Metro, Babel) rather than bundled — the require() calls are the
  // point, not something to route through ESM import.
  {
    files: ["tailwind.config.js", "babel.config.js", "metro.config.js"],
    languageOptions: { sourceType: "commonjs", globals: { __dirname: "readonly", module: "readonly", require: "readonly" } },
    rules: { "@typescript-eslint/no-require-imports": "off" },
  },
];
