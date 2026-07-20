/* eslint-disable */
/**
 * Generated `api` utility.
 *
 * THIS CODE IS AUTOMATICALLY GENERATED.
 *
 * To regenerate, run `npx convex dev`.
 * @module
 */

import type * as alumnos from "../alumnos.js";
import type * as auth from "../auth.js";
import type * as authz from "../authz.js";
import type * as bloque from "../bloque.js";
import type * as bootstrap from "../bootstrap.js";
import type * as correo from "../correo.js";
import type * as credenciales from "../credenciales.js";
import type * as crons from "../crons.js";
import type * as cuotas from "../cuotas.js";
import type * as entorno from "../entorno.js";
import type * as examenEstado from "../examenEstado.js";
import type * as examenes from "../examenes.js";
import type * as fechas from "../fechas.js";
import type * as grupos from "../grupos.js";
import type * as http from "../http.js";
import type * as imagenes from "../imagenes.js";
import type * as instructores from "../instructores.js";
import type * as invitaciones from "../invitaciones.js";
import type * as lecturaCompat from "../lecturaCompat.js";
import type * as lecturas from "../lecturas.js";
import type * as material from "../material.js";
import type * as metricas from "../metricas.js";
import type * as panel from "../panel.js";
import type * as plantillas from "../plantillas.js";
import type * as politica from "../politica.js";
import type * as pruebasImagenes from "../pruebasImagenes.js";
import type * as reactivos from "../reactivos.js";
import type * as sanitizar from "../sanitizar.js";
import type * as seed from "../seed.js";
import type * as seedAuth from "../seedAuth.js";
import type * as sesion from "../sesion.js";
import type * as temario from "../temario.js";
import type * as texto from "../texto.js";
import type * as usuarios from "../usuarios.js";

import type {
  ApiFromModules,
  FilterApi,
  FunctionReference,
} from "convex/server";

declare const fullApi: ApiFromModules<{
  alumnos: typeof alumnos;
  auth: typeof auth;
  authz: typeof authz;
  bloque: typeof bloque;
  bootstrap: typeof bootstrap;
  correo: typeof correo;
  credenciales: typeof credenciales;
  crons: typeof crons;
  cuotas: typeof cuotas;
  entorno: typeof entorno;
  examenEstado: typeof examenEstado;
  examenes: typeof examenes;
  fechas: typeof fechas;
  grupos: typeof grupos;
  http: typeof http;
  imagenes: typeof imagenes;
  instructores: typeof instructores;
  invitaciones: typeof invitaciones;
  lecturaCompat: typeof lecturaCompat;
  lecturas: typeof lecturas;
  material: typeof material;
  metricas: typeof metricas;
  panel: typeof panel;
  plantillas: typeof plantillas;
  politica: typeof politica;
  pruebasImagenes: typeof pruebasImagenes;
  reactivos: typeof reactivos;
  sanitizar: typeof sanitizar;
  seed: typeof seed;
  seedAuth: typeof seedAuth;
  sesion: typeof sesion;
  temario: typeof temario;
  texto: typeof texto;
  usuarios: typeof usuarios;
}>;

/**
 * A utility for referencing Convex functions in your app's public API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = api.myModule.myFunction;
 * ```
 */
export declare const api: FilterApi<
  typeof fullApi,
  FunctionReference<any, "public">
>;

/**
 * A utility for referencing Convex functions in your app's internal API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = internal.myModule.myFunction;
 * ```
 */
export declare const internal: FilterApi<
  typeof fullApi,
  FunctionReference<any, "internal">
>;

export declare const components: {};
