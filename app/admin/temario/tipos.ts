import { type FunctionReturnType } from "convex/server";
import { type api } from "@/convex/_generated/api";

/**
 * La fila del árbol, derivada del DTO y no del schema — idiom del repo
 * (`grupos-client.tsx:26`). Es una unión discriminada por `nivel`, así que el
 * cliente sabe por fila qué campos existen (`tipo` solo en secciones, `areaId`
 * solo en subtemas) sin nullables que haya que comprobar a mano.
 */
export type FilaTemario = FunctionReturnType<
  typeof api.temario.listarArbol
>[number];
