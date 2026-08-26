import { createContext, useContext, useEffect, useState, useCallback } from "react";
import { supabase } from "../supabaseClient";
import { applyTheme } from "./themes";

const SiteSettingsContext = createContext(null);

export function SiteSettingsProvider({ children }) {
  const [settings, setSettings] = useState({
    theme: "fuego", logo_url: "", cover_image_url: "", commission_percent: 8,
    perfil_show_subastas: true, perfil_show_rematazos: true, perfil_show_ranking: true,
    perfil_show_historial: false, perfil_show_direcciones: false,
  });
  const [loaded, setLoaded] = useState(false);

  const load = useCallback(async () => {
    const { data, error } = await supabase.from("site_settings").select("*").eq("id", 1).single();
    if (!error && data) {
      setSettings(data);
      applyTheme(data.theme);
    }
    setLoaded(true);
  }, []);

  useEffect(() => {
    load();
    const channel = supabase
      .channel("site-settings")
      .on("postgres_changes", { event: "*", schema: "public", table: "site_settings" }, load)
      .subscribe();
    return () => supabase.removeChannel(channel);
  }, [load]);

  return (
    <SiteSettingsContext.Provider value={{ ...settings, loaded, refresh: load }}>
      {children}
    </SiteSettingsContext.Provider>
  );
}

export function useSiteSettings() {
  const ctx = useContext(SiteSettingsContext);
  if (!ctx) throw new Error("useSiteSettings debe usarse dentro de <SiteSettingsProvider>");
  return ctx;
}
