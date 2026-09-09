// Los dominios dedicados a cada sección — se calculan una sola vez al cargar
// la página (no dentro de un efecto de React) para que nunca "se disparen de
// nuevo" por accidente durante la navegación dentro de la misma pestaña.
export const REMATAZOS_HOSTNAME = "rematazos.mrfull.online";
export const SUBASTAS_HOSTNAME = "subastas.mrfull.online";
export const CONCURSO_HOSTNAME = "concurso.mrfull.online";

export const isRematazosDomain =
  typeof window !== "undefined" && window.location.hostname === REMATAZOS_HOSTNAME;

export const isConcursoDomain =
  typeof window !== "undefined" && window.location.hostname === CONCURSO_HOSTNAME;

// El dominio principal, sin subdominio (mrfull.online): ahí vive la página
// portal que enlaza a Subastas, Rematazos y Concurso.
export const isApexDomain =
  typeof window !== "undefined" &&
  (window.location.hostname === "mrfull.online" || window.location.hostname === "www.mrfull.online");
