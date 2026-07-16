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
import type * as bootstrap from "../bootstrap.js";
import type * as correo from "../correo.js";
import type * as credenciales from "../credenciales.js";
import type * as crons from "../crons.js";
import type * as cuotas from "../cuotas.js";
import type * as fechas from "../fechas.js";
import type * as grupos from "../grupos.js";
import type * as http from "../http.js";
import type * as instructores from "../instructores.js";
import type * as invitaciones from "../invitaciones.js";
import type * as metricas from "../metricas.js";
import type * as panel from "../panel.js";
import type * as plantillas from "../plantillas.js";
import type * as politica from "../politica.js";
import type * as seed from "../seed.js";
import type * as seedAuth from "../seedAuth.js";
import type * as sesion from "../sesion.js";
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
  bootstrap: typeof bootstrap;
  correo: typeof correo;
  credenciales: typeof credenciales;
  crons: typeof crons;
  cuotas: typeof cuotas;
  fechas: typeof fechas;
  grupos: typeof grupos;
  http: typeof http;
  instructores: typeof instructores;
  invitaciones: typeof invitaciones;
  metricas: typeof metricas;
  panel: typeof panel;
  plantillas: typeof plantillas;
  politica: typeof politica;
  seed: typeof seed;
  seedAuth: typeof seedAuth;
  sesion: typeof sesion;
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
