// Los dominios dedicados a cada sección — se calculan una sola vez al cargar
// la página (no dentro de un efecto de React) para que nunca "se disparen de
// nuevo" por accidente durante la navegación dentro de la misma pestaña.
export const REMATAZOS_HOSTNAME = "rematazos.mrfull.online";
export const SUBASTAS_HOSTNAME = "subastas.mrfull.online";
export const CONCURSO_HOSTNAME = "concurso.mrfull.online";
// La app de pedidos (otro proyecto: Cloudflare Worker "mrfull-fudo-puente"), con el mismo login.
export const PEDIDOS_HOSTNAME = "pedidos.mrfull.online";

/*
 * "Volver después de iniciar sesión": cuando alguien llega al login desde otra app de
 * *.mrfull.online (p. ej. pedidos), se guarda a dónde volver en una cookie compartida.
 * Así, apenas tenga la sesión abierta — por el login, el registro, el enlace del correo
 * de confirmación o cualquier otra página — se le devuelve allá. Dura 30 minutos.
 */
const COOKIE_VOLVER = "mrfull-volver";
export function destinoValido(v) {
  try {
    const u = new URL(v);
    return u.protocol === "https:" && (u.hostname === "mrfull.online" || u.hostname.endsWith(".mrfull.online")) ? u.href : null;
  } catch { return null; }
}
const dominioCookie = () => (window.location.hostname.endsWith("mrfull.online") ? "; Domain=.mrfull.online" : "");
export function recordarVolver(v) {
  const d = destinoValido(v);
  if (d) document.cookie = `${COOKIE_VOLVER}=${encodeURIComponent(d)}${dominioCookie()}; Path=/; Max-Age=1800; SameSite=Lax; Secure`;
}
export function tomarVolver() {
  const m = document.cookie.match(/(?:^|; )mrfull-volver=([^;]*)/);
  if (!m) return null;
  document.cookie = `${COOKIE_VOLVER}=${dominioCookie()}; Path=/; Max-Age=0; SameSite=Lax; Secure`;
  const d = destinoValido(decodeURIComponent(m[1]));
  return d && new URL(d).hostname !== window.location.hostname ? d : null;
}

export const isRematazosDomain =
  typeof window !== "undefined" && window.location.hostname === REMATAZOS_HOSTNAME;

export const isConcursoDomain =
  typeof window !== "undefined" && window.location.hostname === CONCURSO_HOSTNAME;

// El dominio principal, sin subdominio (mrfull.online): ahí vive la página
// portal que enlaza a Subastas, Rematazos y Concurso.
export const isApexDomain =
  typeof window !== "undefined" &&
  (window.location.hostname === "mrfull.online" || window.location.hostname === "www.mrfull.online");
