import { useEffect } from "react";
import { BrowserRouter, Routes, Route, Navigate, useNavigate } from "react-router-dom";
import { AuthProvider, useAuth } from "./lib/auth";
import { SiteSettingsProvider } from "./lib/siteSettings";
import { supabase } from "./supabaseClient";
import { isRematazosDomain } from "./lib/domain";
import NavBar from "./components/NavBar";
import WhatsAppFloatingButton from "./components/WhatsAppFloatingButton";
import Login from "./pages/Login";
import Register from "./pages/Register";
import ForgotPassword from "./pages/ForgotPassword";
import ResetPassword from "./pages/ResetPassword";
import Cliente from "./pages/Cliente";
import Rematazos from "./pages/Rematazos";
import Ranking from "./pages/Ranking";
import AuctionDetail from "./pages/AuctionDetail";
import Admin from "./pages/Admin";
import MyProfile from "./pages/MyProfile";

function RequireAuth({ children }) {
  const { user, loading } = useAuth();
  if (loading) return <div style={{ textAlign: "center", padding: 60, opacity: 0.6 }}>Cargando...</div>;
  if (!user) return <Navigate to="/login" replace />;
  return children;
}

function Shell() {
  const navigate = useNavigate();

  // Seguro: si el enlace de "recuperar contraseña" del correo aterriza en
  // cualquier otra página (por configuración de Supabase), lo mandamos a la
  // pantalla de nueva contraseña de todos modos, para no dejar al usuario
  // con una sesión abierta sin haber cambiado la contraseña.
  useEffect(() => {
    const { data: sub } = supabase.auth.onAuthStateChange((event) => {
      if (event === "PASSWORD_RECOVERY") {
        navigate("/restablecer-password", { replace: true });
      }
    });
    return () => sub.subscription.unsubscribe();
  }, [navigate]);

  return (
    <>
      <NavBar />
      <Routes>
        <Route path="/login" element={<Login />} />
        <Route path="/registro" element={<Register />} />
        <Route path="/olvide-password" element={<ForgotPassword />} />
        <Route path="/restablecer-password" element={<ResetPassword />} />
        {/* rematazos.mrfull.online sirve el mismo build que subastas.mrfull.online
            (Cloudflare Pages), así que "/" muestra una sección u otra según el
            dominio por el que entraste — calculado una sola vez, no en un efecto. */}
        <Route path="/" element={isRematazosDomain ? <Navigate to="/rematazos" replace /> : <Cliente />} />
        <Route path="/rematazos" element={<Rematazos />} />
        <Route path="/ranking" element={<Ranking />} />
        <Route path="/subasta/:id" element={<AuctionDetail />} />
        <Route path="/admin" element={<RequireAuth><Admin /></RequireAuth>} />
        <Route path="/perfil" element={<RequireAuth><MyProfile /></RequireAuth>} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
      <WhatsAppFloatingButton />
    </>
  );
}

export default function App() {
  return (
    <SiteSettingsProvider>
      <AuthProvider>
        <BrowserRouter>
          <Shell />
        </BrowserRouter>
      </AuthProvider>
    </SiteSettingsProvider>
  );
}
