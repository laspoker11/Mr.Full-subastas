import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useAuth } from "../lib/auth";

export default function Login() {
  const { login } = useAuth();
  const nav = useNavigate();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e) {
    e.preventDefault();
    setError(""); setLoading(true);
    const { error } = await login(email.trim(), password);
    setLoading(false);
    if (error) return setError(error.message === "Invalid login credentials"
      ? "Correo o contraseña incorrectos."
      : error.message);
    nav("/");
  }

  return (
    <div style={{ maxWidth: 360, margin: "60px auto", padding: "0 16px" }}>
      <div style={{ fontFamily: "var(--font-display)", fontWeight: 800, fontSize: 26, textAlign: "center", marginBottom: 4 }}>
        🔥 Subastas MrFull
      </div>
      <div style={{ textAlign: "center", fontSize: 13, opacity: 0.6, marginBottom: 20 }}>Inicia sesión para pujar</div>

      <form onSubmit={handleSubmit} className="card" style={{ display: "flex", flexDirection: "column", gap: 10 }}>
        <input className="input" type="email" placeholder="Correo electrónico" value={email} onChange={(e) => setEmail(e.target.value)} required />
        <input className="input" type="password" placeholder="Contraseña" value={password} onChange={(e) => setPassword(e.target.value)} required />
        <button className="btn-primary" disabled={loading} type="submit">{loading ? "Entrando..." : "Entrar"}</button>
        {error && <div className="error-text">{error}</div>}
      </form>

      <div style={{ textAlign: "center", fontSize: 13, marginTop: 14 }}>
        ¿No tienes cuenta? <Link to="/registro" style={{ color: "var(--ladrillo)", fontWeight: 700 }}>Regístrate aquí</Link>
      </div>
      <div style={{ textAlign: "center", fontSize: 12.5, marginTop: 8 }}>
        <Link to="/olvide-password" style={{ color: "var(--carbon)", opacity: 0.6 }}>¿Olvidaste tu contraseña?</Link>
      </div>
    </div>
  );
}
