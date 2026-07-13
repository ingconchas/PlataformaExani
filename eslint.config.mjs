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
    // Biblioteca de diseño de REFERENCIA (React por CDN, no se compila en la app;
    // se traduce a mano a components/ui). No es código de producto → no se lintea.
    "design-reference/**",
    // Código generado por Convex (ya trae su propio eslint-disable).
    "convex/_generated/**",
  ]),
]);

export default eslintConfig;
