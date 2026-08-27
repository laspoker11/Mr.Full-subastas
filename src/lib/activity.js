import { useEffect } from "react";
import { useLocation } from "react-router-dom";
import { supabase } from "../supabaseClient";

const VISITOR_KEY = "mrfull_visitor_id";
const SESSION_KEY = "mrfull_session_id";
const SOURCE_KEY = "mrfull_session_source";

function newId() {
  return crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

// Identifica el navegador de forma anónima y estable entre visitas (como el
// "client id" de Google Analytics), para poder seguir a alguien desde que
// llega sin cuenta hasta que se registra.
function getVisitorId() {
  try {
    let id = localStorage.getItem(VISITOR_KEY);
    if (!id) { id = newId(); localStorage.setItem(VISITOR_KEY, id); }
    return id;
  } catch {
    return null;
  }
}

// De dónde vino el visitante a esta sesión: parámetros ?utm_source=... si
// llegó de una campaña, o el sitio que lo trajo (facebook.com, whatsapp,
// etc.), o "directo" si escribió la URL o entró desde favoritos.
function detectSource() {
  const params = new URLSearchParams(window.location.search);
  if (params.get("utm_source")) {
    return {
      utm_source: params.get("utm_source"),
      utm_medium: params.get("utm_medium") || null,
      utm_campaign: params.get("utm_campaign") || null,
      referrer: document.referrer || null,
    };
  }
  let origin = "directo";
  if (document.referrer) {
    try {
      const refHost = new URL(document.referrer).hostname;
      origin = refHost === window.location.hostname ? "directo" : refHost;
    } catch {
      origin = "directo";
    }
  }
  return { utm_source: origin, utm_medium: null, utm_campaign: null, referrer: document.referrer || null };
}

// Una "sesión" = una visita (dura mientras la pestaña siga abierta). El
// origen se fija una sola vez al abrirla, para no perderlo en la segunda
// página que visite.
function getSession() {
  try {
    let sessionId = sessionStorage.getItem(SESSION_KEY);
    let sourceRaw = sessionStorage.getItem(SOURCE_KEY);
    if (!sessionId || !sourceRaw) {
      sessionId = newId();
      sourceRaw = JSON.stringify(detectSource());
      sessionStorage.setItem(SESSION_KEY, sessionId);
      sessionStorage.setItem(SOURCE_KEY, sourceRaw);
    }
    return { sessionId, source: JSON.parse(sourceRaw) };
  } catch {
    return { sessionId: null, source: {} };
  }
}

async function insertEvent(userId, eventType, path, label) {
  const visitorId = getVisitorId();
  const { sessionId, source } = getSession();
  try {
    await supabase.from("user_activity").insert({
      user_id: userId || null,
      visitor_id: visitorId,
      session_id: sessionId,
      event_type: eventType,
      path,
      label,
      utm_source: source.utm_source || null,
      utm_medium: source.utm_medium || null,
      utm_campaign: source.utm_campaign || null,
      referrer: source.referrer || null,
    });
  } catch {
    // silencioso: la actividad es informativa, nunca debe romper la app
  }
}

// Guarda un movimiento del usuario (vista de página o clic importante) para
// el panel Admin -> Actividad. Se registra tanto de usuarios logueados como
// de visitantes anónimos, identificados por su navegador.
export function logActivity(userId, eventType, path, label = null) {
  insertEvent(userId, eventType, path, label);
}

// Hitos de negocio (registro, inscripción, puja...) para el panel Admin ->
// Actividad, y ya dejados listos para conectar píxeles de publicidad más
// adelante: si algún día se instala Facebook Pixel, Google Ads o TikTok
// Pixel en index.html, estos hitos se disparan solos, sin tocar este código.
export function trackConversion(userId, name, path, extra = {}) {
  insertEvent(userId, "conversion", path, name);
  if (typeof window.fbq === "function") window.fbq("trackCustom", name, extra);
  if (typeof window.gtag === "function") window.gtag("event", name, extra);
  if (typeof window.ttq?.track === "function") window.ttq.track(name, extra);
}

// Registra automáticamente cada cambio de página, la haga un usuario
// logueado o un visitante anónimo.
export function usePageViewTracking(userId) {
  const location = useLocation();
  useEffect(() => {
    logActivity(userId, "page_view", location.pathname);
  }, [userId, location.pathname]);
}
