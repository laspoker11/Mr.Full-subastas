import { createClient } from "@supabase/supabase-js";

// Nota: la "anon/publishable key" de Supabase está diseñada para ser pública —
// la seguridad real vive en las políticas de Row Level Security (RLS) del
// esquema SQL, no en ocultar esta clave. Por eso es seguro tener un respaldo
// directo aquí si las variables de entorno del hosting fallan por algún motivo.
const FALLBACK_SUPABASE_URL = "https://rxbnxusfxlqetfcayybz.supabase.co";
const FALLBACK_SUPABASE_ANON_KEY = "sb_publishable_oBqicY0WR_96JN78JU_miA_wryvJ3pv";

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL || FALLBACK_SUPABASE_URL;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY || FALLBACK_SUPABASE_ANON_KEY;

/*
 * LOGIN ÚNICO en todo *.mrfull.online
 * La sesión se guarda en una cookie del dominio .mrfull.online (no en el localStorage de
 * cada subdominio). Así quien entra en subastas., rematazos., concurso. o mrfull.online
 * queda dentro en todos, y también en pedidos.mrfull.online (la app de pedidos lee esta
 * misma cookie en su servidor).
 * Formato: cookies "<clave>.0", "<clave>.1"… con el JSON de la sesión en base64url,
 * partido en trozos de 3000 caracteres (una cookie admite ~4 KB).
 * Fuera de mrfull.online (pages.dev, localhost) se sigue usando localStorage como antes.
 */
const DOMINIO = "mrfull.online";
const enMrFull = typeof window !== "undefined" &&
  (window.location.hostname === DOMINIO || window.location.hostname.endsWith("." + DOMINIO));
const TROZO = 3000, MAX_TROZOS = 6, DURACION = 400 * 24 * 3600; // 400 días

const b64 = s => btoa(unescape(encodeURIComponent(s))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const deb64 = s => decodeURIComponent(escape(atob(s.replace(/-/g, "+").replace(/_/g, "/"))));
function leerCookies() {
  const m = {};
  for (const par of document.cookie.split("; ")) { const i = par.indexOf("="); if (i > 0) m[par.slice(0, i)] = par.slice(i + 1); }
  return m;
}
function ponerCookie(nombre, valor, maxAge) {
  document.cookie = `${nombre}=${valor}; Domain=.${DOMINIO}; Path=/; Max-Age=${maxAge}; SameSite=Lax; Secure`;
}

const almacenCompartido = {
  getItem(clave) {
    const c = leerCookies();
    if (c[clave + ".0"] !== undefined) {
      let txt = "";
      for (let i = 0; i < MAX_TROZOS && c[`${clave}.${i}`] !== undefined; i++) txt += c[`${clave}.${i}`];
      try { return deb64(txt); } catch { return null; }
    }
    // Primera vez con el login único: si la sesión estaba en el localStorage de este
    // subdominio, se pasa a la cookie compartida para que nadie tenga que volver a entrar.
    const vieja = window.localStorage.getItem(clave);
    if (vieja) { almacenCompartido.setItem(clave, vieja); window.localStorage.removeItem(clave); }
    return vieja;
  },
  setItem(clave, valor) {
    const txt = b64(valor), n = Math.ceil(txt.length / TROZO);
    if (n > MAX_TROZOS) { window.localStorage.setItem(clave, valor); return; } // nunca debería pasar
    for (let i = 0; i < MAX_TROZOS; i++) {
      if (i < n) ponerCookie(`${clave}.${i}`, txt.slice(i * TROZO, (i + 1) * TROZO), DURACION);
      else ponerCookie(`${clave}.${i}`, "", 0); // borra trozos sobrantes de una sesión anterior más larga
    }
  },
  removeItem(clave) {
    for (let i = 0; i < MAX_TROZOS; i++) ponerCookie(`${clave}.${i}`, "", 0);
    window.localStorage.removeItem(clave);
  },
};

export const supabase = createClient(supabaseUrl, supabaseAnonKey,
  enMrFull ? { auth: { storage: almacenCompartido, persistSession: true, autoRefreshToken: true } } : undefined);
