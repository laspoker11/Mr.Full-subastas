import { useEffect, useState, useCallback, useMemo } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "../supabaseClient";
import { useAuth } from "../lib/auth";
import Countdown, { useClockTick } from "../components/Countdown";
import { fmtMoney } from "../components/AuctionCard";
import { waLink, waRematazoMessage } from "../lib/whatsapp";
import { logActivity } from "../lib/activity";
import { Zap, Users } from "lucide-react";

export default function Rematazos() {
  const { user, profile } = useAuth();
  const navigate = useNavigate();
  useClockTick();

  const [rematazos, setRematazos] = useState([]);
  const [categories, setCategories] = useState([]);
  const [selectedCategory, setSelectedCategory] = useState(null);
  const [mySignups, setMySignups] = useState({});
  const [loading, setLoading] = useState(true);
  const [openFormId, setOpenFormId] = useState(null);
  const [formState, setFormState] = useState({ modo: "domicilio", direccion: "" });
  const [busyId, setBusyId] = useState(null);
  const [errorById, setErrorById] = useState({});

  const load = useCallback(async () => {
    const { data: r } = await supabase
      .from("rematazos").select("*").neq("status", "cancelado").eq("hidden_public", false)
      .order("created_at", { ascending: false }).limit(60);
    setRematazos(r || []);
    const { data: c } = await supabase.from("rematazo_categories").select("*").order("name", { ascending: true });
    setCategories(c || []);
    setLoading(false);
  }, []);

  const loadMySignups = useCallback(async () => {
    if (!user) return setMySignups({});
    const { data } = await supabase
      .from("rematazo_signups").select("*").eq("user_id", user.id)
      .order("created_at", { ascending: false });
    // Si te sacaron y te volviste a inscribir puede haber varias filas para
    // el mismo rematazo — nos quedamos con la más reciente de cada uno.
    const map = {};
    (data || []).forEach((s) => { if (!map[s.rematazo_id]) map[s.rematazo_id] = s; });
    setMySignups(map);
  }, [user]);

  useEffect(() => {
    load();
    const channel = supabase
      .channel("rematazos-publico")
      .on("postgres_changes", { event: "*", schema: "public", table: "rematazos" }, load)
      .subscribe();
    return () => supabase.removeChannel(channel);
  }, [load]);

  useEffect(() => {
    loadMySignups();
    if (!user) return;
    const channel = supabase
      .channel(`rematazos-mias-${user.id}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "rematazo_signups", filter: `user_id=eq.${user.id}` }, loadMySignups)
      .subscribe();
    return () => supabase.removeChannel(channel);
  }, [user, loadMySignups]);

  const filtered = selectedCategory ? rematazos.filter((r) => r.category_id === selectedCategory) : rematazos;

  const grouped = useMemo(() => {
    const withCat = categories
      .map((c) => ({ cat: c, items: filtered.filter((r) => r.category_id === c.id) }))
      .filter((g) => g.items.length > 0);
    const sinCategoria = filtered.filter((r) => !r.category_id);
    return sinCategoria.length ? [...withCat, { cat: { id: "sin-categoria", name: "Otros" }, items: sinCategoria }] : withCat;
  }, [filtered, categories]);

  function openForm(r) {
    if (!user) return navigate("/login");
    setErrorById((prev) => ({ ...prev, [r.id]: "" }));
    setOpenFormId(r.id);
    setFormState({ modo: r.entrega_modo === "local" ? "local" : "domicilio", direccion: "" });
  }

  async function submitSignup(r) {
    const modo = r.entrega_modo === "mixto" ? formState.modo : r.entrega_modo;
    if (modo === "domicilio" && !formState.direccion.trim()) {
      return setErrorById((prev) => ({ ...prev, [r.id]: "Escribe tu dirección para el domicilio." }));
    }
    setErrorById((prev) => ({ ...prev, [r.id]: "" }));
    setBusyId(r.id);
    const { error } = await supabase.rpc("rematazo_signup", {
      p_rematazo_id: r.id, p_entrega_via: modo,
      p_direccion: modo === "domicilio" ? formState.direccion.trim() : "",
    });
    setBusyId(null);
    if (error) return setErrorById((prev) => ({ ...prev, [r.id]: error.message }));
    logActivity(user.id, "click", location.pathname, `inscribirse_rematazo:${r.id}`);
    setOpenFormId(null);
    loadMySignups();
  }

  function confirmWhatsapp(signup) {
    supabase.rpc("confirm_rematazo_contact", { p_signup_id: signup.id }).then(loadMySignups);
  }

  return (
    <div style={{ maxWidth: 720, margin: "0 auto", padding: "20px 14px 60px" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 4 }}>
        <Zap size={22} color="var(--ladrillo)" />
        <div style={{ fontFamily: "var(--font-display)", fontWeight: 800, fontSize: 22 }}>Rematazos</div>
      </div>
      <div style={{ fontSize: 13.5, opacity: 0.7, marginBottom: 16 }}>
        Precio de rematazo, cupos contados. Cada producto se acaba cuando llega su hora o cuando se llenan los cupos
        — lo que pase primero. Al inscribirte quedas en la lista de una vez; después confirmas tus datos por WhatsApp.
      </div>

      {categories.length > 0 && (
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 18 }}>
          <button
            onClick={() => setSelectedCategory(null)} className="pill"
            style={{
              border: "none", cursor: "pointer", fontSize: 12.5, padding: "6px 14px",
              background: !selectedCategory ? "var(--ladrillo)" : "var(--crema-suave)",
              color: !selectedCategory ? "white" : "var(--carbon)",
            }}
          >
            Todas
          </button>
          {categories.map((c) => (
            <button
              key={c.id} onClick={() => setSelectedCategory(c.id)} className="pill"
              style={{
                border: "none", cursor: "pointer", fontSize: 12.5, padding: "6px 14px",
                background: selectedCategory === c.id ? "var(--ladrillo)" : "var(--crema-suave)",
                color: selectedCategory === c.id ? "white" : "var(--carbon)",
              }}
            >
              {c.name}
            </button>
          ))}
        </div>
      )}

      {loading ? (
        <div style={{ textAlign: "center", padding: 60, opacity: 0.6 }}>Cargando rematazos...</div>
      ) : grouped.length === 0 ? (
        <div className="card" style={{ textAlign: "center", padding: 50 }}>
          <Zap size={30} color="var(--ladrillo)" />
          <div style={{ fontFamily: "var(--font-display)", fontWeight: 700, fontSize: 17, marginTop: 8 }}>
            No hay rematazos activos ahora
          </div>
          <div style={{ fontSize: 13, opacity: 0.6, marginTop: 4 }}>
            En cuanto MrFull publique uno, aparecerá aquí. ¡Mantente atento!
          </div>
        </div>
      ) : (
        grouped.map((g) => (
          <div key={g.cat.id} style={{ marginBottom: 26 }}>
            <div style={{ fontFamily: "var(--font-display)", fontWeight: 700, fontSize: 15, marginBottom: 10 }}>
              {g.cat.name} ({g.items.length})
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
              {g.items.map((r) => (
                <RematazoCard
                  key={r.id} r={r} signup={mySignups[r.id]}
                  formOpen={openFormId === r.id} formState={formState} setFormState={setFormState}
                  busy={busyId === r.id} error={errorById[r.id]}
                  onOpenForm={() => openForm(r)} onCancelForm={() => setOpenFormId(null)}
                  onSubmit={() => submitSignup(r)} onConfirmWhatsapp={() => confirmWhatsapp(mySignups[r.id])}
                  fullName={profile?.full_name || ""}
                />
              ))}
            </div>
          </div>
        ))
      )}
    </div>
  );
}

function RematazoCard({ r, signup, formOpen, formState, setFormState, busy, error, onOpenForm, onCancelForm, onSubmit, onConfirmWhatsapp, fullName }) {
  const timeLimited = r.limite_tipo === "tiempo" || r.limite_tipo === "ambos";
  const qtyLimited = r.limite_tipo === "cantidad" || r.limite_tipo === "ambos";
  const ended = r.status !== "activo";
  const agotado = ended && qtyLimited && r.cupos_usados >= (r.cupos_max || 0);
  const pct = qtyLimited ? Math.min(100, Math.round((r.cupos_usados / Math.max(r.cupos_max, 1)) * 100)) : 0;

  return (
    <div className="card" style={{ display: "flex", gap: 12, flexDirection: "column" }}>
      <div style={{ display: "flex", gap: 12 }}>
        <div style={{
          width: 64, height: 64, borderRadius: 12, overflow: "hidden", flexShrink: 0,
          background: "var(--crema-suave)", display: "flex", alignItems: "center", justifyContent: "center",
        }}>
          {r.image_url ? <img src={r.image_url} alt={r.title} style={{ width: "100%", height: "100%", objectFit: "cover" }} /> : <Zap size={22} color="var(--ladrillo)" />}
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 8 }}>
            <div style={{ fontFamily: "var(--font-display)", fontWeight: 700, fontSize: 15.5 }}>{r.title}</div>
            <span className="pill" style={{ background: ended ? "#ddd" : "var(--salsa)", color: ended ? "var(--carbon)" : "white", flexShrink: 0 }}>
              {ended ? (agotado ? "Agotado" : "Terminó") : "En vivo"}
            </span>
          </div>
          {r.description && <div style={{ fontSize: 12.5, opacity: 0.7, marginTop: 2 }}>{r.description}</div>}
          <div style={{ display: "flex", alignItems: "baseline", gap: 8, marginTop: 4 }}>
            <span style={{ fontFamily: "var(--font-mono)", fontWeight: 700, fontSize: 18, color: "var(--ladrillo)" }}>{fmtMoney(r.price)}</span>
            {r.old_price && <span style={{ fontSize: 12, opacity: 0.5, textDecoration: "line-through" }}>{fmtMoney(r.old_price)}</span>}
          </div>
        </div>
      </div>

      {timeLimited && r.status === "activo" && r.ends_at && (
        <div style={{ fontSize: 12.5, opacity: 0.75, display: "flex", alignItems: "center", gap: 5 }}>
          🕒 Se acaba en <Countdown endsAt={r.ends_at} />
        </div>
      )}

      {qtyLimited ? (
        <div>
          <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12, opacity: 0.7 }}>
            <span>Inscritos</span>
            <span style={{ fontFamily: "var(--font-mono)", fontWeight: 700 }}>{r.cupos_usados} / {r.cupos_max}</span>
          </div>
          <div style={{ height: 7, borderRadius: 999, background: "var(--crema-suave)", overflow: "hidden", marginTop: 3 }}>
            <div style={{ width: `${pct}%`, height: "100%", background: pct >= 70 ? "var(--alerta)" : "var(--salsa)" }} />
          </div>
        </div>
      ) : (
        <div style={{ fontSize: 12, opacity: 0.7, display: "flex", alignItems: "center", gap: 5 }}>
          <Users size={13} /> {r.cupos_usados} inscritos
        </div>
      )}

      {signup ? (
        <SignupStatus signup={signup} r={r} fullName={fullName} onConfirmWhatsapp={onConfirmWhatsapp} />
      ) : ended ? (
        <button className="btn-primary" disabled style={{ opacity: 0.4 }}>Cupos cerrados</button>
      ) : formOpen ? (
        <div style={{ display: "flex", flexDirection: "column", gap: 8, background: "var(--crema-suave)", borderRadius: 10, padding: 10 }}>
          {r.entrega_modo === "mixto" && (
            <div style={{ display: "flex", gap: 14, fontSize: 13 }}>
              <label style={{ display: "flex", alignItems: "center", gap: 5 }}>
                <input type="radio" checked={formState.modo === "domicilio"} onChange={() => setFormState({ ...formState, modo: "domicilio" })} /> Domicilio
              </label>
              <label style={{ display: "flex", alignItems: "center", gap: 5 }}>
                <input type="radio" checked={formState.modo === "local"} onChange={() => setFormState({ ...formState, modo: "local" })} /> Recojo en el local
              </label>
            </div>
          )}
          {(r.entrega_modo === "domicilio" || (r.entrega_modo === "mixto" && formState.modo === "domicilio")) && (
            <input
              className="input" placeholder="Dirección de entrega" value={formState.direccion}
              onChange={(e) => setFormState({ ...formState, direccion: e.target.value })}
            />
          )}
          <div style={{ display: "flex", gap: 8 }}>
            <button className="btn-primary" style={{ flex: 1 }} disabled={busy} onClick={onSubmit}>
              {busy ? "..." : "Confirmar inscripción"}
            </button>
            <button className="btn-ghost" onClick={onCancelForm} disabled={busy}>Cancelar</button>
          </div>
          {error && <div className="error-text">{error}</div>}
        </div>
      ) : (
        <button className="btn-primary" onClick={onOpenForm}>Inscribirme</button>
      )}
    </div>
  );
}

function SignupStatus({ signup, r, fullName, onConfirmWhatsapp }) {
  if (signup.status === "cancelado") {
    return (
      <div className="error-text">
        Tu cupo fue cancelado{signup.cancel_reason ? `: ${signup.cancel_reason}` : "."}
      </div>
    );
  }
  if (signup.status === "redimido") {
    return <div className="success-text">🎉 Ya reclamaste este rematazo.</div>;
  }
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
      <div className="success-text">
        ✓ Estás inscrito{signup.entrega_via === "domicilio" ? ` — domicilio a ${signup.direccion}` : " — recoges en el local"}
      </div>
      {signup.status === "inscrito" ? (
        <a
          href={waLink(waRematazoMessage({ title: r.title, price: r.price, fullName }))}
          target="_blank" rel="noopener noreferrer" onClick={onConfirmWhatsapp}
          style={{
            display: "flex", alignItems: "center", justifyContent: "center", gap: 8,
            background: "#25D366", color: "white", borderRadius: 10, padding: "10px 16px",
            fontWeight: 700, fontSize: 13.5, textDecoration: "none",
          }}
        >
          💬 Confirmar datos por WhatsApp
        </a>
      ) : (
        <div style={{ fontSize: 12.5, opacity: 0.7 }}>Ya confirmaste tus datos — MrFull te contactará para coordinar.</div>
      )}
    </div>
  );
}
