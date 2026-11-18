import js from "@eslint/js";
import globals from "globals";
import tseslint from "typescript-eslint";
import reactHooks from "eslint-plugin-react-hooks";
import reactRefresh from "eslint-plugin-react-refresh";

/** Preset mínimo y sin type-checking: de los tipos ya se encarga `tsc --noEmit`
 *  en el mismo comando `check`, así que aquí solo buscamos errores reales de
 *  React y de JS (`no-unused-vars` incluido). */
export default tseslint.config(
  // `schema.ts` y `openapi.json` son generados (`pnpm gen:api`): no se lintean.
  { ignores: ["dist", "src/core/schema.ts"] },
  {
    files: ["**/*.{ts,tsx}"],
    extends: [js.configs.recommended, ...tseslint.configs.recommended],
    languageOptions: { ecmaVersion: 2022, globals: globals.browser },
    plugins: { "react-hooks": reactHooks, "react-refresh": reactRefresh },
    rules: {
      ...reactHooks.configs.recommended.rules,
      "react-refresh/only-export-components": "warn",
    },
  },
  {
    files: ["vite.config.ts", "eslint.config.js", "scripts/**/*.mjs"],
    languageOptions: { globals: globals.node },
  },
);
