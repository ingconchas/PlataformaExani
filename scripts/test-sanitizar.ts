/**
 * Prueba de SEGURIDAD del saneador (LUI-15 E2). Es LA prueba de XSS: un E2E de
 * happy-path no la cubre porque TipTap nunca produce `<script>`. Corre con
 * `npm run test:sanitizar` (tsx → sin depender del type-stripping de Node).
 */
import { sanear, aTextoPlano, textoPlanoAHtml } from "../convex/sanitizar";

let ok = 0;
let fallos = 0;
function check(nombre: string, cond: boolean, detalle = "") {
  if (cond) ok++;
  else {
    fallos++;
    console.error(`  ✘ ${nombre}${detalle ? ` — ${detalle}` : ""}`);
  }
}

// Núcleo de seguridad: tras quitar los tags EXACTOS de la whitelist, NO debe quedar
// ningún `<` crudo en la salida (todo lo demás se escapó).
const sinCrudos = (out: string) =>
  !out.replace(/<\/?(?:b|strong|i|em|sup|sub|p)>|<br>/g, "").includes("<");

// Caracteres INVISIBLES construidos por code point (evita literales invisibles en el
// fuente): zero-width space, word joiner, LTR mark.
const ZWSP = String.fromCodePoint(0x200b);
const WJ = String.fromCodePoint(0x2060);
const LRM = String.fromCodePoint(0x200e);
// Default_Ignorable que NO son Cf (evaden \p{Cf}): VS-16 y CGJ son Mn; FVS1 y la vocal
// inherente jemer son Other_Default_Ignorable.
const VS16 = String.fromCodePoint(0xfe0f);
const CGJ = String.fromCodePoint(0x034f);
const FVS1 = String.fromCodePoint(0x180b);
const KHVI = String.fromCodePoint(0x17b4);

const PAYLOADS = [
  "<script>alert(1)</script>",
  "<img src=x onerror=alert(1)>",
  "<svg/onload=alert(1)>",
  "<b onclick=alert(1)>hi</b>",
  '<b onmouseover="alert(1)">x</b>',
  '<a href="javascript:alert(1)">x</a>',
  "<!-- c --><img onerror=x>",
  "<![CDATA[<script>x</script>]]>",
  "<b<script>alert(1)</script>",
  "<<b>",
  "<scr<b>ipt>",
  "<style>*{color:red}</style>",
  "<iframe src=x></iframe>",
  "<textarea></textarea><img onerror=x>",
  '<img src="data:text/html,<script>x">',
  '<div srcdoc="<script>x">',
  "< img>",
  "<IMG SRC=x ONERROR=alert(1)>",
  "&lt;script&gt;alert(1)&lt;/script&gt;",
  "&amp;lt;script&amp;gt;",
  '<b x=">"><img onerror=x>',
  "<sup/onload=alert(1)>",
  "<b\tonclick=x>y</b>",
  "<b\nonclick=x>y</b>",
  '<noscript><p title="</noscript><img onerror=x>">',
  '<b title="a>b" onclick=alert(1)>hi</b>',
  "<math><mtext><script>x</script></mtext></math>",
  "<svg><animate onbegin=alert(1)></svg>",
  "texto plano sin tags con 3 < 5 y a & b",
  "<strong>ok</strong> <sup>2</sup> <sub>3</sub> <em>i</em>",
  "<scr\x00ipt>alert(1)</scr\x00ipt>", // null byte
  "＜script＞alert(1)＜/script＞", // fullwidth U+FF1C / U+FF1E
];

console.log("test-sanitizar · saneador");
for (const p of PAYLOADS) {
  const out = sanear(p);
  check(`sin crudos: ${p.slice(0, 34)}`, sinCrudos(out), `→ ${out}`);
  check(`sin <script: ${p.slice(0, 22)}`, !/<script/i.test(out));
  check(`idempotente: ${p.slice(0, 22)}`, sanear(out) === out);
}

// Los tags permitidos SÍ sobreviven; los atributos SIEMPRE se descartan.
check("negrita sobrevive", sanear("<strong>x</strong>") === "<strong>x</strong>");
check("superíndice sobrevive", sanear("x<sup>2</sup>") === "x<sup>2</sup>");
check("atributos descartados", sanear('<b onclick="x">y</b>') === "<b>y</b>");
check("</br> se normaliza", !sanear("a<br/>b</br>").includes("</br>"));

// aTextoPlano: entidades numéricas hostiles NO lanzan (protege `reactivos.listar`).
for (const h of ["&#999999999;", "&#xFFFFFFFF;", "&#0;", "&#xD800;", "&#;", "&#x;"]) {
  let lanzo = false;
  try {
    aTextoPlano("<p>" + h + "</p>");
  } catch {
    lanzo = true;
  }
  check(`aTextoPlano no lanza: ${h}`, !lanzo);
}
check("aTextoPlano vacía <p></p>", aTextoPlano("<p></p>") === "");
check("aTextoPlano vacía <p><br></p>", aTextoPlano("<p><br></p>") === "");
check("aTextoPlano junta inline: x2", aTextoPlano("x<sup>2</sup>") === "x2");
check(
  "aTextoPlano no doble-decodifica",
  aTextoPlano("&amp;lt;script&amp;gt;") === "&lt;script&gt;",
);
// Contenido INVISIBLE: no debe contar como «no vacío» (medio de auditoría) — ni directo
// ni codificado.
check("aTextoPlano vacía invisible codificado", aTextoPlano("&#x200B;&#x2060;") === "");
check("aTextoPlano vacía invisible directo", aTextoPlano(ZWSP + WJ + LRM) === "");
check(
  "aTextoPlano conserva lo visible entre invisibles",
  aTextoPlano(ZWSP + "hola" + ZWSP) === "hola",
);
// Default_Ignorable NO-Cf: U+FE0F, U+034F, U+180B, U+17B4 (directo y codificado). \p{Cf}
// solo NO los caza; \p{Default_Ignorable_Code_Point} sí.
check("aTextoPlano vacía DI directo", aTextoPlano(VS16 + CGJ + FVS1 + KHVI) === "");
check(
  "aTextoPlano vacía DI codificado",
  aTextoPlano("&#xFE0F;&#x34F;&#x180B;&#x17B4;") === "",
);
check("aTextoPlano vacía solo VS16", aTextoPlano(VS16) === "");
check("aTextoPlano conserva la base sin su selector", aTextoPlano("x" + VS16) === "x");

// textoPlanoAHtml: escape COMPLETO (legado literal seguro).
check(
  "textoPlanoAHtml escapa <b> literal",
  textoPlanoAHtml("el tag <b> es negrita") === "<p>el tag &lt;b&gt; es negrita</p>",
);
check("textoPlanoAHtml escapa &", textoPlanoAHtml("a & b") === "<p>a &amp; b</p>");
check("textoPlanoAHtml salto→br", textoPlanoAHtml("a\nb") === "<p>a<br>b</p>");

console.log(`\n${fallos === 0 ? "✅" : "❌"} test-sanitizar: ${ok} ok · ${fallos} fallos`);
process.exit(fallos === 0 ? 0 : 1);
