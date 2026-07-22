import { MisExamenesClient } from "./examenes-client";

/**
 * «Mis exámenes» de la alumna (LUI-25 · Diseño 24). Server component mínimo, como el resto
 * de las pantallas con datos: el cliente hace la query y deriva con su reloj anclado.
 */
export default function Page() {
  return <MisExamenesClient />;
}
