import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    // Playwright artefacts.
    "test-results/**",
    "playwright-report/**",
  ]),
  {
    // Playwright fixtures are `async ({ … }, use) => { await use(value) }`, and the React Hooks
    // rule reads that `use` as React 19's `use()` hook called outside a component. There is no
    // React in `e2e/` at all, so the rule has nothing correct to say here.
    files: ["e2e/**/*.ts"],
    rules: { "react-hooks/rules-of-hooks": "off" },
  },
]);

export default eslintConfig;
