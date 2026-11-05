import js from "@eslint/js";
import reactHooks from "eslint-plugin-react-hooks";
import globals from "globals";
import tseslint from "typescript-eslint";

export default tseslint.config(
  { ignores: ["**/node_modules/**", "**/dist/**", "**/coverage/**", "server/data/**", "server/workspaces/**", "mockup/**", ".claude/**", "test-results/**"] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ["app/**/*.{ts,tsx}"],
    languageOptions: { globals: globals.browser },
    plugins: { "react-hooks": reactHooks },
    rules: { ...reactHooks.configs.recommended.rules },
  },
  {
    files: ["server/**/*.{ts,mjs}", "scripts/**/*.mjs", "*.config.{js,ts}", "shared/**/*.ts"],
    languageOptions: { globals: globals.node },
  },
  {
    rules: {
      "@typescript-eslint/no-unused-vars": ["error", { argsIgnorePattern: "^_", varsIgnorePattern: "^_" }],
      "@typescript-eslint/no-non-null-assertion": "off",
      "no-console": ["error", { allow: ["warn", "error", "log"] }],
    },
  },
  {
    // Os testes podem usar asserções não nulas e funções locais mais soltas.
    files: ["**/*.test.{ts,tsx}"],
    rules: { "@typescript-eslint/no-explicit-any": "off" },
  },
);
