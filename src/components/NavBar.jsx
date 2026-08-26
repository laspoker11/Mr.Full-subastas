import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useAuth } from "../lib/auth";
import { useSiteSettings } from "../lib/siteSettings";
import { supabase } from "../supabaseClient";

export default function NavBar() {
  const { user, profile, isAdmin, logout } = useAuth();
  const { logo_url } = useSiteSettings();
  const nav = useNavigate();
  const [onlineCount, setOnlineCount] = useState(0);

  // Presence de Supabase Realtime: cualquiera (con sesión o no) escucha el
  // conteo, pero solo los usuarios con sesión iniciada se registran (track)
  useEffect(() => {
    const channel = supabase.channel("online-users", {
      config: { presence: { key: user?.id || `anon-${Math.random()}` } },
    });

    channel.on("presence", { event: "sync" }, () => {
      setOnlineCount(Object.keys(channel.presenceState()).length);
    });

    channel.subscribe(async (status) => {
      if (status === "SUBSCRIBED" && user) {
        await channel.track({ online_at: new Date().toISOString() });
      }
    });

    return () => { supabase.removeChannel(channel); };
  }, [user?.id]);

  return (
    <div style={{ background: "var(--carbon)", padding: "14px 16px", position: "sticky", top: 0, zIndex: 20 }}>
      <div style={{ maxWidth: 760, margin: "0 auto", display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", rowGap: 8 }}>
        <Link to="/" style={{ textDecoration: "none", display: "flex", alignItems: "center", gap: 8 }}>
          {logo_url ? (
            <img src={logo_url} alt="Logo" style={{ width: 34, height: 34, borderRadius: 10, objectFit: "cover" }} />
          ) : (
            <div style={{ background: "var(--ladrillo)", borderRadius: 10, width: 34, height: 34, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 18 }}>
              🔥
            </div>
          )}
          <span style={{ fontFamily: "var(--font-display)", fontWeight: 800, fontSize: 19, color: "var(--crema-suave)" }}>
            Subastas MrFull
          </span>
        </Link>

        <div style={{ display: "flex", alignItems: "center", justifyContent: "flex-end", flexWrap: "wrap", rowGap: 6, gap: 10 }}>
          <span style={{ fontSize: 11.5, color: "var(--texto-sobre-oscuro)", opacity: 0.75, display: "flex", alignItems: "center", gap: 4, whiteSpace: "nowrap" }}>
            🟢 {onlineCount} en línea
          </span>
          <Link to="/rematazos" style={{ textDecoration: "none", color: "var(--texto-sobre-oscuro)", fontSize: 13, fontWeight: 700 }}>
            ⚡ Rematazos
          </Link>
          {user && (
            <Link to="/ranking" style={{ textDecoration: "none", color: "var(--texto-sobre-oscuro)", fontSize: 13, fontWeight: 700 }}>
              🏆 Ranking
            </Link>
          )}
          {user && (
            <Link to="/perfil" style={{ textDecoration: "none", color: "var(--texto-sobre-oscuro)", fontSize: 13, fontWeight: 700 }}>
              👤 Mi Perfil
            </Link>
          )}
          {isAdmin && (
            <Link to="/admin" style={{ textDecoration: "none", color: "var(--queso)", fontSize: 13, fontWeight: 700 }}>
              Panel Admin
            </Link>
          )}
          {user ? (
            <button
              onClick={async () => { await logout(); nav("/login"); }}
              style={{ background: "transparent", border: "1px solid #ffffff30", color: "var(--texto-sobre-oscuro)", borderRadius: 8, padding: "6px 12px", fontSize: 12.5, cursor: "pointer" }}
            >
              Salir ({profile?.full_name?.split(" ")[0] || "..."})
            </button>
          ) : (
            <Link to="/login" style={{ textDecoration: "none", color: "var(--texto-sobre-oscuro)", fontSize: 13, fontWeight: 700 }}>
              Iniciar sesión
            </Link>
          )}
        </div>
      </div>
    </div>
  );
}
