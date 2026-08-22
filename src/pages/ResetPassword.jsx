import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { supabase } from "../supabaseClient";

export default function ResetPassword() {
  const nav = useNavigate();
  const [checking, setChecking] = useState(true);
  const [validSession, setValidSession] = useState(false);
  const [password, setPassword] = useState("");
  const [password2, setPassword2] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [done, setDone] = useState(false);

  useEffect(() => {
    let resolved = false;

    const { data: sub } = supabase.auth.onAuthStateChange((event) => {
      if (event === "PASSWORD_RECOVERY") {
        resolved = true;
        setValidSession(true);
        setChecking(false);
      }
    });

    supabase.auth.getSession().then(({ data }) => {
      if (resolved) return;
      setValidSession(!!data.session);
      setChecking(false);
    });

    return () => sub.subscription.unsubscribe();
  }, []);

  async function handleSubmit(e) {
    e.preventDefault();
    setError("");
    if (password.length < 6) return setError("La contraseña debe tener al menos 6 caracteres.");
    if (password !== password2) return setError("Las contraseñas no coinciden.");

    setLoading(true);
    const { error } = await supabase.auth.updateUser({ password });
    setLoading(false);
    if (error) return setError(error.message);
    setDone(true);
    setTimeout(() => nav("/"), 1500);
  }

  if (checking) {
    return <div style={{ textAlign: "center", padding: 60, opacity: 0.6 }}>Verificando enlace...</div>;
  }

  if (!validSession) {
    return (
      <div style={{ maxWidth: 360, margin: "60px auto", padding: "0 16px", textAlign: "center" }}>
        <div style={{ fontSize: 32 }}>⏰</div>
        <div style={{ fontFamily: "var(--font-display)", fontWeight: 700, fontSize: 18, marginTop: 8 }}>
          Este enlace ya venció
        </div>
        <div style={{ fontSize: 13, opacity: 0.7, marginTop: 6 }}>
          Pide un nuevo enlace para restablecer tu contraseña.
        </div>
        <Link to="/olvide-password" className="btn-primary" style={{ display: "inline-block", marginTop: 16, textDecoration: "none" }}>
          Pedir un nuevo enlace
        </Link>
      </div>
    );
  }

  if (done) {
    return (
      <div style={{ maxWidth: 360, margin: "60px auto", padding: "0 16px", textAlign: "center" }}>
        <div style={{ fontSize: 32 }}>✅</div>
        <div style={{ fontFamily: "var(--font-display)", fontWeight: 700, fontSize: 18, marginTop: 8 }}>
          Contraseña actualizada
        </div>
        <div style={{ fontSize: 13, opacity: 0.7, marginTop: 6 }}>Te llevamos al inicio...</div>
      </div>
    );
  }

  return (
    <div style={{ maxWidth: 360, margin: "60px auto", padding: "0 16px" }}>
      <div style={{ fontFamily: "var(--font-display)", fontWeight: 800, fontSize: 26, textAlign: "center", marginBottom: 4 }}>
        🔥 Subastas MrFull
      </div>
      <div style={{ textAlign: "center", fontSize: 13, opacity: 0.6, marginBottom: 20 }}>Elige tu nueva contraseña</div>

      <form onSubmit={handleSubmit} className="card" style={{ display: "flex", flexDirection: "column", gap: 10 }}>
        <input className="input" type="password" placeholder="Nueva contraseña (mínimo 6 caracteres)" value={password} onChange={(e) => setPassword(e.target.value)} required />
        <input className="input" type="password" placeholder="Repite la nueva contraseña" value={password2} onChange={(e) => setPassword2(e.target.value)} required />
        <button className="btn-primary" disabled={loading} type="submit">{loading ? "Guardando..." : "Guardar nueva contraseña"}</button>
        {error && <div className="error-text">{error}</div>}
      </form>
    </div>
  );
}
