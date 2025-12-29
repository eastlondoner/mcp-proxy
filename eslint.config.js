import eslint from "@eslint/js";
import tseslint from "typescript-eslint";

export default tseslint.config(
  eslint.configs.recommended,
  ...tseslint.configs.strictTypeChecked,
  ...tseslint.configs.stylisticTypeChecked,
  {
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
  },
  {
    rules: {
      // Enforce explicit return types on functions
      "@typescript-eslint/explicit-function-return-type": "error",

      // Enforce explicit accessibility modifiers
      "@typescript-eslint/explicit-member-accessibility": ["error", {
        accessibility: "explicit",
        overrides: {
          constructors: "no-public",
        },
      }],

      // Prefer nullish coalescing
      "@typescript-eslint/prefer-nullish-coalescing": "error",

      // Prefer optional chain
      "@typescript-eslint/prefer-optional-chain": "error",

      // No floating promises
      "@typescript-eslint/no-floating-promises": "error",

      // Require await for async functions that return promises
      "@typescript-eslint/require-await": "error",

      // No misused promises
      "@typescript-eslint/no-misused-promises": "error",

      // Consistent type imports
      "@typescript-eslint/consistent-type-imports": ["error", {
        prefer: "type-imports",
        fixStyle: "inline-type-imports",
      }],

      // Consistent type exports
      "@typescript-eslint/consistent-type-exports": ["error", {
        fixMixedExportsWithInlineTypeSpecifier: true,
      }],

      // No unnecessary conditions
      "@typescript-eslint/no-unnecessary-condition": "error",

      // Switch exhaustiveness check
      "@typescript-eslint/switch-exhaustiveness-check": "error",
    },
  },
  {
    ignores: ["dist/", "node_modules/", "eslint.config.js"],
  }
);
