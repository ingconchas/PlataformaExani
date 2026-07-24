/**
 * DRIVER del backfill + verificador bifásico de `ultimosDiagnosticos` (LUI-24).
 *
 * La verificación de una propiedad GLOBAL (cada puntero es el máximo elegible de su alumna)
 * se procesa por páginas y por fases; este driver las encadena hasta terminar y SUMA las
 * discrepancias. Es la SECUENCIA OBLIGATORIA del despliegue del PR A a producción:
 *
 *   npx convex deploy               # (A ya desplegado: escritor + funciones)
 *   node scripts/verificar-punteros.mjs --prod          # backfill + verificar
 *
 * Sin `--prod` corre contra dev. Sale con código 1 si hay CUALQUIER discrepancia o
 * malformado (el operador NO debe habilitar el PR B hasta ver 0/0), y registra el resultado
 * para el reporte.
 *
 * Es de solo lectura salvo el BACKFILL, que es idempotente y monótono (correrlo dos veces
 * converge). No toca datos de alumnas: solo el read-model derivado.
 */
import { spawn } from "node:child_process";
import { conducirBackfill, conducirVerificacion } from "./lui24-drivers.mjs";

const PROD = process.argv.includes("--prod");
const FLAGS = PROD ? ["--prod"] : [];

function ejecutar(cmd, args) {
  return new Promise((resolve) => {
    const p = spawn(cmd, args, { stdio: ["ignore", "pipe", "pipe"] });
    let salida = "";
    p.stdout.on("data", (b) => (salida += b));
    p.stderr.on("data", (b) => (salida += b));
    p.on("close", (code) => resolve({ code, salida }));
    p.on("error", (e) => resolve({ code: -1, salida: String(e) }));
  });
}
async function correr(fn, args) {
  const { code, salida } = await ejecutar("npx", [
    "convex",
    "run",
    ...FLAGS,
    fn,
    JSON.stringify(args),
  ]);
  if (code !== 0) throw new Error(`«${fn}» código ${code}: ${salida.trim()}`);
  const m = salida.match(/\{[\s\S]*\}/);
  if (!m) throw new Error(`Salida sin JSON de «${fn}»: ${salida.slice(0, 300)}`);
  return JSON.parse(m[0]);
}

const entorno = PROD ? "PRODUCCIÓN" : "dev";
console.log(`\n▸ ${entorno}: BACKFILL de ultimosDiagnosticos (idempotente)`);
const { estampados, malformados: malformadosBackfill } = await conducirBackfill(correr);
console.log(`  estampados: ${estampados} · malformados: ${malformadosBackfill}`);

console.log(`\n▸ ${entorno}: VERIFICADOR bifásico`);
const { discrepancias, malformados } = await conducirVerificacion(correr);
console.log(`  discrepancias: ${discrepancias} · malformados: ${malformados}`);

const limpio = discrepancias === 0 && malformados === 0 && malformadosBackfill === 0;
console.log(
  `\n${limpio ? "✔" : "✘"} ${entorno}: read-model ${limpio ? "EXACTO (habilita el PR B)" : "CON DISCREPANCIAS — NO habilitar B"}\n`,
);
process.exit(limpio ? 0 : 1);
