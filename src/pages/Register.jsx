import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useAuth } from "../lib/auth";

export default function Register() {
  const { register } = useAuth();
  const nav = useNavigate();
  const [fullName, setFullName] = useState("");
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [ok, setOk] = useState(false);
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e) {
    e.preventDefault();
    setError("");
    if (password.length < 6) return setError("La contraseña debe tener al menos 6 caracteres.");
    if (!fullName.trim() || !phone.trim()) return setError("Cuéntanos tu nombre y tu número de celular.");
    setLoading(true);
    const { error } = await register(email.trim(), password, fullName.trim(), phone.trim());
    setLoading(false);
    if (error) return setError(error.message);
    setOk(true);
  }

  if (ok) {
    return (
      <div style={{ maxWidth: 360, margin: "60px auto", padding: "0 16px", textAlign: "center" }}>
        <div style={{ fontSize: 32 }}>📩</div>
        <div style={{ fontFamily: "var(--font-display)", fontWeight: 700, fontSize: 18, marginTop: 8 }}>
          ¡Ya casi! Revisa tu correo
        </div>
        <div style={{ fontSize: 13, opacity: 0.7, marginTop: 6 }}>
          Te enviamos un enlace de confirmación a {email}. Confírmalo y luego inicia sesión.
        </div>
        <Link to="/login" className="btn-primary" style={{ display: "inline-block", marginTop: 16, textDecoration: "none" }}>
          Ir a iniciar sesión
        </Link>
      </div>
    );
  }

  return (
    <div style={{ maxWidth: 360, margin: "60px auto", padding: "0 16px" }}>
      <div style={{ fontFamily: "var(--font-display)", fontWeight: 800, fontSize: 26, textAlign: "center", marginBottom: 4 }}>
        🔥 Subastas MrFull
      </div>
      <div style={{ textAlign: "center", fontSize: 13, opacity: 0.6, marginBottom: 20 }}>Crea tu cuenta para pujar</div>

      <form onSubmit={handleSubmit} className="card" style={{ display: "flex", flexDirection: "column", gap: 10 }}>
        <input className="input" placeholder="Tu nombre completo" value={fullName} onChange={(e) => setFullName(e.target.value)} required />
        <input className="input" placeholder="Tu número de celular" value={phone} onChange={(e) => setPhone(e.target.value)} required />
        <input className="input" type="email" placeholder="Correo electrónico" value={email} onChange={(e) => setEmail(e.target.value)} required />
        <input className="input" type="password" placeholder="Contraseña (mínimo 6 caracteres)" value={password} onChange={(e) => setPassword(e.target.value)} required />
        <button className="btn-primary" disabled={loading} type="submit">{loading ? "Creando cuenta..." : "Crear cuenta"}</button>
        {error && <div className="error-text">{error}</div>}
      </form>

      <div style={{ textAlign: "center", fontSize: 13, marginTop: 14 }}>
        ¿Ya tienes cuenta? <Link to="/login" style={{ color: "var(--ladrillo)", fontWeight: 700 }}>Inicia sesión</Link>
      </div>
    </div>
  );
}
