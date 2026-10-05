import js from "@eslint/js";
import globals from "globals";
import tseslint from "typescript-eslint";

export default tseslint.config(
  { ignores: ["dist", "tmp", "test-results", "playwright-report", ".wrangler", "node_modules"] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ["src/**/*.ts"],
    languageOptions: { globals: globals.serviceworker },
  },
  {
    files: ["e2e/**/*.ts", "*.{ts,js}"],
    languageOptions: { globals: globals.node },
  },
);
