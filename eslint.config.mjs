import nextCoreWebVitals from "eslint-config-next/core-web-vitals";
import nextTypescript from "eslint-config-next/typescript";
import { dirname } from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// P1 / OPS: previously this config disabled every meaningful rule, making
// `bunx eslint .` a no-op. We now enable a sensible subset of rules that
// catch real bugs without producing massive noise on the existing codebase.
// Rules that would produce thousands of warnings on legacy code remain off
// (no-explicit-any, no-unused-vars) — to be turned on incrementally.
const eslintConfig = [...nextCoreWebVitals, ...nextTypescript, {
  rules: {
    // TypeScript rules — keep off for now (codebase uses `any` pervasively).
    "@typescript-eslint/no-explicit-any": "off",
    "@typescript-eslint/no-unused-vars": "off",
    "@typescript-eslint/no-non-null-assertion": "off",
    "@typescript-eslint/ban-ts-comment": "off",
    "@typescript-eslint/prefer-as-const": "off",
    "@typescript-eslint/no-unused-disable-directive": "off",

    // React rules — enable the high-value ones.
    "react-hooks/exhaustive-deps": "warn",   // was off — catches stale-closure bugs
    "react-hooks/purity": "off",
    "react/no-unescaped-entities": "off",
    "react/display-name": "off",
    "react/prop-types": "off",
    "react-compiler/react-compiler": "off",

    // Next.js rules
    "@next/next/no-img-element": "off",
    "@next/next/no-html-link-for-pages": "off",

    // General JavaScript rules — enable the high-value ones.
    "prefer-const": "warn",                 // was off — catches accidental reassignment
    "no-unused-vars": "off",                // TS handles this
    "no-console": "off",                    // logger.ts wraps console; allow direct use
    "no-debugger": "error",                 // was off — debug statements must not ship
    "no-empty": "warn",                     // was off — empty catch blocks are suspicious
    "no-irregular-whitespace": "error",
    "no-case-declarations": "off",
    "no-fallthrough": "error",              // was off — switch fallthrough is usually a bug
    "no-mixed-spaces-and-tabs": "error",
    "no-redeclare": "off",                  // TS handles this
    "no-undef": "off",                      // TS handles this
    "no-unreachable": "error",              // was off — code after return/throw is dead
    "no-useless-escape": "warn",
  },
}, {
  ignores: ["node_modules/**", ".next/**", "out/**", "build/**", "next-env.d.ts", "examples/**", "skills", "apps/mobile/**"],
}];

export default eslintConfig;
