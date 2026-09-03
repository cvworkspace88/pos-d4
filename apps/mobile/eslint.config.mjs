import { config } from "@repo/eslint-config/react";

/** @type {import("eslint").Linter.Config[]} */
export default [...config, { ignores: [".expo/**", "expo-env.d.ts"] }];
