import { useState } from "react";
import { Link } from "react-router-dom";
import { supabase } from "../supabaseClient";

export default function ForgotPassword() {
  const [email, setEmail] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [sent, setSent] = useState(false);

  async function handleSubmit(e) {
    e.preventDefault();
    setError(""); setLoading(true);
    await supabase.auth.resetPasswordForEmail(email.trim(), {
      redirectTo: `${window.location.origin}/restablecer-password`,
    });
    setLoading(false);
    // Siempre mostramos el mismo mensaje, exista o no el correo (por privacidad).
    setSent(true);
  }

  if (sent) {
    return (
      <div style={{ maxWidth: 360, margin: "60px auto", padding: "0 16px", textAlign: "center" }}>
        <div style={{ fontSize: 32 }}>📩</div>
        <div style={{ fontFamily: "var(--font-display)", fontWeight: 700, fontSize: 18, marginTop: 8 }}>
          Revisa tu correo
        </div>
        <div style={{ fontSize: 13, opacity: 0.7, marginTop: 6 }}>
          Si {email} tiene una cuenta con nosotros, te enviamos un enlace para restablecer tu contraseña.
        </div>
        <Link to="/login" className="btn-primary" style={{ display: "inline-block", marginTop: 16, textDecoration: "none" }}>
          Volver a iniciar sesión
        </Link>
      </div>
    );
  }

  return (
    <div style={{ maxWidth: 360, margin: "60px auto", padding: "0 16px" }}>
      <div style={{ fontFamily: "var(--font-display)", fontWeight: 800, fontSize: 26, textAlign: "center", marginBottom: 4 }}>
        🔥 Subastas MrFull
      </div>
      <div style={{ textAlign: "center", fontSize: 13, opacity: 0.6, marginBottom: 20 }}>
        Escribe tu correo y te enviamos un enlace para restablecer tu contraseña
      </div>

      <form onSubmit={handleSubmit} className="card" style={{ display: "flex", flexDirection: "column", gap: 10 }}>
        <input className="input" type="email" placeholder="Correo electrónico" value={email} onChange={(e) => setEmail(e.target.value)} required />
        <button className="btn-primary" disabled={loading} type="submit">{loading ? "Enviando..." : "Enviar enlace"}</button>
        {error && <div className="error-text">{error}</div>}
      </form>

      <div style={{ textAlign: "center", fontSize: 13, marginTop: 14 }}>
        <Link to="/login" style={{ color: "var(--ladrillo)", fontWeight: 700 }}>Volver a iniciar sesión</Link>
      </div>
    </div>
  );
}
