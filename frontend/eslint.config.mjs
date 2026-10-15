import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  {
    rules: {
      // Enforce const over let when variables are never reassigned
      "prefer-const": "error",

      // Warn on console log statements (allows console.warn and console.error)
      "no-console": ["warn", { allow: ["warn", "error"] }],

      // Ban the use of var instead of let or const
      "no-var": "error",

      // Enforce strict equality operators
      eqeqeq: "error",

      // Prevent use of any
      "@typescript-eslint/no-explicit-any": "warn",

      // Flag variables, imports, or parameters that are declared but never used
      "@typescript-eslint/no-unused-vars": [
        "warn",
        {
          argsIgnorePattern: "^_",
          varsIgnorePattern: "^_",
        },
      ],

      // Agreed upon naming conventions
      "@typescript-eslint/naming-convention": [
        "error",
        // camelCase for regular variables, functions, and parameters
        {
          selector: "default",
          format: ["camelCase"],
          leadingUnderscore: "allow",
        },
        // PascalCase for React components, classes, types, interfaces and enums
        {
          selector: ["typeLike"],
          format: ["PascalCase"],
        },
        // UPPER_CASE for global constants
        {
          selector: "variable",
          modifiers: ["const", "global"],
          format: ["UPPER_CASE"],
        },
        // PascalCase allowed for React functional components assigned to variables
        {
          selector: "property",
          format: null,
        },
        //Ignore properties that come from external APIs, DB responses, or libraries
        {
          selector: "property",
          format: null,
        },
      ],
    },
  },
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
  ]),
]);

export default eslintConfig;
