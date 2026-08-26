// El dominio dedicado a Rematazos — se calcula una sola vez al cargar la
// página (no dentro de un efecto de React) para que nunca "se dispare de
// nuevo" por accidente durante la navegación dentro de la misma pestaña.
export const REMATAZOS_HOSTNAME = "rematazos.mrfull.online";
export const SUBASTAS_HOSTNAME = "subastas.mrfull.online";

export const isRematazosDomain =
  typeof window !== "undefined" && window.location.hostname === REMATAZOS_HOSTNAME;
