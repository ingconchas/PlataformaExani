/** Estilos para renderizar el HTML saneado (strong/em/sup/sub) de forma consistente en
 *  todas las vistas de reactivo. Vive aquí —y no copiado en cada archivo— porque ya lo
 *  consumen el formulario, el modal de preview y el recuadro de material; una tercera copia
 *  es justo la clase de duplicación que el repo evita (ver `convex/texto.ts`). */
export const CLASE_RICO =
  "[&_strong]:font-semibold [&_em]:italic [&_sup]:align-super [&_sup]:text-[0.7em] [&_sub]:align-sub [&_sub]:text-[0.7em]";
