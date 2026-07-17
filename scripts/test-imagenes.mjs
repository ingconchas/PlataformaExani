/**
 * test:imagenes (LUI-15 E3) — LA prueba del ciclo de vida de blobs de imagen, el análogo
 * de test:sanitizar. Las guardas server-side (metadata falsa, SVG, tamaño, exclusividad)
 * y el sweeper paginado con corte estable NO se alcanzan por la UI honesta (requireStaff
 * bloquea el CLI). La orquestación y TODAS las aserciones viven en
 * `convex/pruebasImagenes.ts` (dev-only, llamando el MISMO `validarImagen`/`barrer` de
 * producción); este script solo la dispara y propaga el código de salida.
 *
 * Requiere: `npx convex dev` (deployment de desarrollo).  Uso: node scripts/test-imagenes.mjs
 */

import { spawn } from "node:child_process";

function correr(cmd, args) {
  return new Promise((resolve) => {
    const p = spawn(cmd, args, { stdio: ["ignore", "pipe", "pipe"] });
    let salida = "";
    p.stdout.on("data", (b) => (salida += b));
    p.stderr.on("data", (b) => (salida += b));
    p.on("close", (code) => resolve({ code: code ?? 1, salida }));
    p.on("error", (e) => resolve({ code: 1, salida: String(e) }));
  });
}
const conv = (fn, args = '{"confirmar":"SOLO_DEV"}') =>
  correr("npx", ["convex", "run", fn, args]);

console.log("test-imagenes · pizarra limpia (reactivos para adjuntar)…");
await conv("seed:limpiarContenidoDemo");
await conv("seed:cargarDatosDePrueba");

let code = 1;
try {
  const r = await conv("pruebasImagenes:correrPruebasImagenesDev");
  console.log(r.salida.trim());
  code = r.code;
} finally {
  await conv("seed:limpiarContenidoDemo");
  await conv("seed:cargarDatosDePrueba");
}

console.log(
  `\n${code === 0 ? "✅ test-imagenes: OK" : "❌ test-imagenes: FALLÓ"}\n`,
);
process.exit(code === 0 ? 0 : 1);
