import { useEffect } from "react";
import { useLocation } from "react-router-dom";
import { supabase } from "../supabaseClient";

// Guarda un movimiento del usuario (vista de página o clic importante) para
// el panel Admin -> Actividad. Solo se registra si hay sesión iniciada —
// nunca de visitantes anónimos — y si falla no interrumpe nada más.
export async function logActivity(userId, eventType, path, label = null) {
  if (!userId) return;
  try {
    await supabase.from("user_activity").insert({ user_id: userId, event_type: eventType, path, label });
  } catch {
    // silencioso: la actividad es informativa, nunca debe romper la app
  }
}

// Registra automáticamente cada cambio de página del usuario logueado.
export function usePageViewTracking(userId) {
  const location = useLocation();
  useEffect(() => {
    logActivity(userId, "page_view", location.pathname);
  }, [userId, location.pathname]);
}
