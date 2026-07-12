import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

// Endpoint de salud (criterio de LUI-5). Reporta el estado de la app y si la
// conexión a Convex ya está configurada. Cuando existan funciones Convex se
// puede extender para hacer un ping real a la base de datos.
export async function GET() {
  const convexConfigured = Boolean(process.env.NEXT_PUBLIC_CONVEX_URL);
  return NextResponse.json({
    status: "ok",
    service: "exani-ii-platform",
    convex: convexConfigured ? "configured" : "not_configured",
    timestamp: new Date().toISOString(),
  });
}
