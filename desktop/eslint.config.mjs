import globals from "globals";
import tsParser from "@typescript-eslint/parser";
import reactHooks from "eslint-plugin-react-hooks";
import jsxA11y from "eslint-plugin-jsx-a11y";

const sharedLanguageOptions = {
  parser: tsParser,
  ecmaVersion: "latest",
  sourceType: "module",
  globals: {
    ...globals.browser,
    ...globals.node,
    ...globals.vitest,
  },
  parserOptions: {
    ecmaFeatures: {
      jsx: true,
    },
  },
};

const sharedHooksRules = {
  "react-hooks/rules-of-hooks": "error",
  "react-hooks/exhaustive-deps": "warn",
};

const sharedA11yRules = {
  "jsx-a11y/alt-text": "warn",
  "jsx-a11y/anchor-is-valid": "warn",
  "jsx-a11y/label-has-associated-control": "warn",
  "jsx-a11y/no-autofocus": "warn",
};

export default [
  {
    ignores: ["build/**", "dist/**", "node_modules/**", "release/**"],
  },
  {
    files: ["src/renderer/**/*.{ts,tsx}", "tests/**/*.{ts,tsx}"],
    languageOptions: sharedLanguageOptions,
    plugins: {
      "react-hooks": reactHooks,
    },
    rules: sharedHooksRules,
  },
  {
    files: ["src/renderer/**/*.{tsx}", "tests/**/*.{tsx}"],
    languageOptions: sharedLanguageOptions,
    plugins: {
      "jsx-a11y": jsxA11y,
    },
    rules: sharedA11yRules,
  },
];
