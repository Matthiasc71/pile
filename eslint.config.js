import js from "@eslint/js";
import globals from "globals";
import tseslint from "typescript-eslint";

export default tseslint.config(
  { ignores: ["**/node_modules/**", "**/dist/**", "**/.wrangler/**", ".claude/**", "design/**", "coverage/**", "**/test-results/**", "**/playwright-report/**"] },
  js.configs.recommended,
  ...tseslint.configs.strict,
  // Node scripts (CI helpers, configs).
  { files: ["scripts/**/*.mjs", "**/*.config.{js,ts}"], languageOptions: { globals: globals.node } },
  // End-to-end tests: Playwright boxes and fixtures are known to exist.
  { files: ["app/e2e/**/*.ts"], rules: { "@typescript-eslint/no-non-null-assertion": "off" } },
  {
    // Application code: Alpaca hosts only as the two constants (tests build strings from pieces).
    files: ["worker/src/**/*.ts", "app/src/**/*.ts", "app/src/**/*.tsx"],
    rules: {
      "no-restricted-syntax": ["error", {
        selector: "Literal[value=/alpaca\\.markets/]:not([value=/^https:\\/\\/(paper-api|data)\\.alpaca\\.markets$/])",
        message: "Alpaca hosts live only in worker/src/alpaca.ts as the PAPER_BASE / DATA_BASE constants (rule 0.1).",
      }],
    },
  },
);
