import { Link, useNavigate } from "react-router-dom";
import { useAuth } from "../lib/auth";

export default function NavBar() {
  const { user, profile, isAdmin, logout } = useAuth();
  const nav = useNavigate();

  return (
    <div style={{ background: "var(--carbon)", padding: "14px 16px", position: "sticky", top: 0, zIndex: 20 }}>
      <div style={{ maxWidth: 760, margin: "0 auto", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <Link to="/" style={{ textDecoration: "none", display: "flex", alignItems: "center", gap: 8 }}>
          <div style={{ background: "var(--ladrillo)", borderRadius: 10, width: 34, height: 34, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 18 }}>
            🔥
          </div>
          <span style={{ fontFamily: "var(--font-display)", fontWeight: 800, fontSize: 19, color: "var(--crema)" }}>
            Subastas MrFull
          </span>
        </Link>

        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          {isAdmin && (
            <Link to="/admin" style={{ textDecoration: "none", color: "var(--queso)", fontSize: 13, fontWeight: 700 }}>
              Panel Admin
            </Link>
          )}
          {user ? (
            <button
              onClick={async () => { await logout(); nav("/login"); }}
              style={{ background: "transparent", border: "1px solid #ffffff30", color: "var(--crema)", borderRadius: 8, padding: "6px 12px", fontSize: 12.5, cursor: "pointer" }}
            >
              Salir ({profile?.full_name?.split(" ")[0] || "..."})
            </button>
          ) : (
            <Link to="/login" style={{ textDecoration: "none", color: "var(--crema)", fontSize: 13, fontWeight: 700 }}>
              Iniciar sesión
            </Link>
          )}
        </div>
      </div>
    </div>
  );
}
