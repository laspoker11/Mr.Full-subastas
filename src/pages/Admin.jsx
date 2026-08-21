import { useEffect, useState, useCallback } from "react";
import { supabase } from "../supabaseClient";
import { useAuth } from "../lib/auth";
import { timeParts, useClockTick } from "../components/Countdown";
import { fmtMoney } from "../components/AuctionCard";
import { Plus, X, Check, RefreshCw, AlertTriangle, Clock3 } from "lucide-react";

export default function Admin() {
  const { isAdmin, loading } = useAuth();
  useClockTick();

  if (loading) return <div style={{ textAlign: "center", padding: 60, opacity: 0.6 }}>Cargando...</div>;
  if (!isAdmin) {
    return (
      <div style={{ maxWidth: 360, margin: "60px auto", textAlign: "center", padding: "0 16px" }}>
        <div style={{ fontFamily: "var(--font-display)", fontWeight: 700, fontSize: 18 }}>Acceso restringido</div>
        <div style={{ fontSize: 13, opacity: 0.6, marginTop: 6 }}>
          Tu cuenta no tiene permisos de administrador. Si crees que deberías tenerlos, contacta al dueño del negocio.
        </div>
      </div>
    );
  }
  return <AdminDashboard />;
}

function AdminDashboard() {
  const [auctions, setAuctions] = useState([]);
  const [templates, setTemplates] = useState([]);
  const [bidsByAuction, setBidsByAuction] = useState({});
  const [profilesById, setProfilesById] = useState({});
  const [form, setForm] = useState({
    title: "", description: "", imageUrl: "", startPrice: 25000, durationMin: 15, confirmWindowMin: 15,
    startMode: "now", // "now" | "scheduled"
    startAt: "", // datetime-local string
    saveAsTemplate: false,
    repeatCount: 1, repeatEveryHours: 24,
  });
  const [formError, setFormError] = useState("");
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    const { data: a } = await supabase.from("auctions").select("*").neq("status", "void").order("starts_at", { ascending: true }).limit(60);
    setAuctions(a || []);
    const { data: t } = await supabase.from("auction_templates").select("*").order("created_at", { ascending: false });
    setTemplates(t || []);
    const { data: b } = await supabase.from("bids").select("*").order("created_at", { ascending: false });
    const byAuction = {};
    (b || []).forEach((bid) => {
      byAuction[bid.auction_id] = byAuction[bid.auction_id] || [];
      byAuction[bid.auction_id].push(bid);
    });
    setBidsByAuction(byAuction);
    const userIds = [...new Set((b || []).map((x) => x.user_id))];
    if (userIds.length) {
      const { data: profs } = await supabase.from("profiles").select("id, full_name").in("id", userIds);
      const { data: contacts } = await supabase.from("contact_info").select("id, phone").in("id", userIds);
      const phoneById = {};
      (contacts || []).forEach((c) => (phoneById[c.id] = c.phone));
      const map = {};
      (profs || []).forEach((p) => (map[p.id] = { full_name: p.full_name, phone: phoneById[p.id] || "" }));
      setProfilesById(map);
    }
  }, []);

  useEffect(() => {
    load();
    const channel = supabase
      .channel("admin-dashboard")
      .on("postgres_changes", { event: "*", schema: "public", table: "auctions" }, load)
      .on("postgres_changes", { event: "*", schema: "public", table: "bids" }, load)
      .subscribe();
    return () => supabase.removeChannel(channel);
  }, [load]);

  function useTemplate(t) {
    setForm((f) => ({
      ...f, title: t.title, description: t.description, imageUrl: t.image_url,
      startPrice: t.start_price, durationMin: t.duration_min, confirmWindowMin: t.confirm_window_min,
    }));
  }

  async function deleteTemplate(id) {
    if (!confirm("¿Borrar esta plantilla?")) return;
    const { error } = await supabase.rpc("delete_template", { p_template_id: id });
    if (error) alert(error.message);
    load();
  }

  async function createAuction() {
    setFormError("");
    if (!form.title.trim()) return setFormError("Ponle un nombre al producto.");
    if (!form.startPrice || form.startPrice <= 0) return setFormError("El precio inicial debe ser mayor a 0.");
    if (!form.durationMin || form.durationMin <= 0) return setFormError("La duración debe ser mayor a 0 minutos.");
    if (form.startMode === "scheduled" && !form.startAt) return setFormError("Elige la fecha y hora de inicio.");
    if (Number(form.repeatCount) > 1 && form.startMode !== "scheduled") {
      return setFormError("Para repetir varias veces, primero elige una fecha/hora de inicio.");
    }

    const startsAtISO = form.startMode === "scheduled" ? new Date(form.startAt).toISOString() : new Date().toISOString();

    setSaving(true);

    if (form.saveAsTemplate) {
      await supabase.rpc("save_template", {
        p_title: form.title.trim(), p_description: form.description.trim(), p_image_url: form.imageUrl.trim(),
        p_start_price: Number(form.startPrice), p_duration_min: Number(form.durationMin), p_confirm_window_min: Number(form.confirmWindowMin) || 15,
      });
    }

    let error;
    if (Number(form.repeatCount) > 1) {
      ({ error } = await supabase.rpc("schedule_recurring_auctions", {
        p_title: form.title.trim(), p_description: form.description.trim(), p_image_url: form.imageUrl.trim(),
        p_start_price: Number(form.startPrice), p_duration_min: Number(form.durationMin), p_confirm_window_min: Number(form.confirmWindowMin) || 15,
        p_first_start: startsAtISO, p_repeat_count: Number(form.repeatCount), p_interval_hours: Number(form.repeatEveryHours) || 24,
      }));
    } else {
      ({ error } = await supabase.rpc("create_auction", {
        p_title: form.title.trim(), p_description: form.description.trim(), p_image_url: form.imageUrl.trim(),
        p_start_price: Number(form.startPrice), p_duration_min: Number(form.durationMin), p_confirm_window_min: Number(form.confirmWindowMin) || 15,
        p_starts_at: startsAtISO,
      }));
    }

    setSaving(false);
    if (error) return setFormError("Error al publicar: " + error.message);
    setForm({
      title: "", description: "", imageUrl: "", startPrice: 25000, durationMin: 15, confirmWindowMin: 15,
      startMode: "now", startAt: "", saveAsTemplate: false, repeatCount: 1, repeatEveryHours: 24,
    });
    load();
  }

  const now = Date.now();
  const runningAuctions = auctions.filter((a) => (a.status === "live" && new Date(a.starts_at).getTime() <= now) || a.status === "confirming");
  const scheduledAuctions = auctions.filter((a) => a.status === "live" && new Date(a.starts_at).getTime() > now);
  const closedAuctions = auctions.filter((a) => a.status === "closed");

  return (
    <div style={{ maxWidth: 760, margin: "0 auto", padding: "20px 14px 60px", display: "flex", flexDirection: "column", gap: 20 }}>
      <button onClick={load} className="btn-ghost" style={{ alignSelf: "flex-end", display: "flex", alignItems: "center", gap: 5 }}>
        <RefreshCw size={13} /> Actualizar
      </button>

      <div className="card">
        <div style={{ fontFamily: "var(--font-display)", fontWeight: 700, fontSize: 16, marginBottom: 10, display: "flex", alignItems: "center", gap: 6 }}>
          <Plus size={16} /> Publicar o programar subasta
        </div>

        {templates.length > 0 && (
          <div style={{ marginBottom: 12 }}>
            <div style={{ fontSize: 11.5, fontWeight: 700, opacity: 0.6, marginBottom: 6 }}>PLANTILLAS GUARDADAS</div>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
              {templates.map((t) => (
                <div key={t.id} style={{ display: "flex", alignItems: "center", gap: 4, background: "var(--crema-suave)", borderRadius: 20, padding: "4px 6px 4px 12px" }}>
                  <button onClick={() => useTemplate(t)} style={{ background: "none", border: "none", cursor: "pointer", fontSize: 12.5, fontWeight: 600 }}>
                    {t.title} · {fmtMoney(t.start_price)}
                  </button>
                  <button onClick={() => deleteTemplate(t.id)} style={{ background: "none", border: "none", cursor: "pointer", color: "var(--alerta)", display: "flex" }}>
                    <X size={12} />
                  </button>
                </div>
              ))}
            </div>
          </div>
        )}

        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          <input className="input" placeholder="Producto (ej: Hamburguesa Familiar)" value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} />
          <input className="input" placeholder="Descripción corta (opcional)" value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} />
          <input className="input" placeholder="URL de la imagen (opcional)" value={form.imageUrl} onChange={(e) => setForm({ ...form, imageUrl: e.target.value })} />
          <div style={{ display: "flex", gap: 8 }}>
            <LabeledInput label="Precio inicial" value={form.startPrice} onChange={(v) => setForm({ ...form, startPrice: v })} />
            <LabeledInput label="Duración (min)" value={form.durationMin} onChange={(v) => setForm({ ...form, durationMin: v })} />
            <LabeledInput label="Confirmar (min)" value={form.confirmWindowMin} onChange={(v) => setForm({ ...form, confirmWindowMin: v })} />
          </div>

          <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12.5, marginTop: 2 }}>
            <input type="checkbox" checked={form.saveAsTemplate} onChange={(e) => setForm({ ...form, saveAsTemplate: e.target.checked })} />
            Guardar como plantilla estándar (para reusar después)
          </label>

          <div style={{ borderTop: `1px solid var(--crema-suave)`, marginTop: 6, paddingTop: 10 }}>
            <div style={{ display: "flex", gap: 14, fontSize: 13, marginBottom: 8 }}>
              <label style={{ display: "flex", alignItems: "center", gap: 5 }}>
                <input type="radio" checked={form.startMode === "now"} onChange={() => setForm({ ...form, startMode: "now" })} />
                Empezar ahora mismo
              </label>
              <label style={{ display: "flex", alignItems: "center", gap: 5 }}>
                <input type="radio" checked={form.startMode === "scheduled"} onChange={() => setForm({ ...form, startMode: "scheduled" })} />
                Programar fecha/hora
              </label>
            </div>

            {form.startMode === "scheduled" && (
              <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                <div>
                  <div style={{ fontSize: 10.5, opacity: 0.5, marginBottom: 2 }}>Fecha y hora de inicio</div>
                  <input className="input" type="datetime-local" value={form.startAt} onChange={(e) => setForm({ ...form, startAt: e.target.value })} />
                </div>
                <div style={{ display: "flex", gap: 8 }}>
                  <LabeledInput label="Repetir X veces" value={form.repeatCount} onChange={(v) => setForm({ ...form, repeatCount: v })} />
                  <LabeledInput label="Cada cuántas horas" value={form.repeatEveryHours} onChange={(v) => setForm({ ...form, repeatEveryHours: v })} />
                </div>
                {Number(form.repeatCount) > 1 && (
                  <div style={{ fontSize: 11.5, opacity: 0.6 }}>
                    Se crearán {form.repeatCount} subastas idénticas, cada una {form.repeatEveryHours} horas después de la anterior.
                  </div>
                )}
              </div>
            )}
          </div>

          <button className="btn-primary" onClick={createAuction} disabled={saving} style={{ marginTop: 4 }}>
            {saving ? "Publicando..." : Number(form.repeatCount) > 1 ? `Programar ${form.repeatCount} subastas` : form.startMode === "scheduled" ? "Programar subasta" : "Iniciar subasta"}
          </button>
          {formError && <div className="error-text" style={{ display: "flex", alignItems: "center", gap: 5 }}><AlertTriangle size={13} /> {formError}</div>}
        </div>
      </div>

      {runningAuctions.length > 0 && (
        <div>
          <div style={{ fontFamily: "var(--font-display)", fontWeight: 700, fontSize: 15, marginBottom: 10 }}>
            Subastas en vivo ahora ({runningAuctions.length})
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
            {runningAuctions.map((a) => (
              <AuctionAdminCard
                key={a.id}
                auction={a}
                bids={bidsByAuction[a.id] || []}
                profilesById={profilesById}
                onChanged={load}
              />
            ))}
          </div>
        </div>
      )}

      {scheduledAuctions.length > 0 && (
        <div>
          <div style={{ fontFamily: "var(--font-display)", fontWeight: 700, fontSize: 15, marginBottom: 10, display: "flex", alignItems: "center", gap: 6 }}>
            <Clock3 size={15} /> Programadas ({scheduledAuctions.length})
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            {scheduledAuctions.map((a) => (
              <div key={a.id} className="card" style={{ padding: "10px 14px", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <div>
                  <div style={{ fontWeight: 700, fontSize: 13.5 }}>{a.title}</div>
                  <div style={{ fontSize: 11.5, opacity: 0.6 }}>
                    Empieza: {new Date(a.starts_at).toLocaleString("es-CO", { dateStyle: "medium", timeStyle: "short" })}
                  </div>
                </div>
                <button
                  className="btn-ghost"
                  style={{ color: "var(--alerta)" }}
                  onClick={async () => { await supabase.rpc("cancel_auction", { p_auction_id: a.id }); load(); }}
                >
                  Cancelar
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

      {closedAuctions.length > 0 && (
        <div>
          <div style={{ fontFamily: "var(--font-display)", fontWeight: 700, fontSize: 15, marginBottom: 10, opacity: 0.7 }}>
            Historial ({closedAuctions.length})
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            {closedAuctions.slice(0, 15).map((a) => {
              const top = [...(bidsByAuction[a.id] || [])].filter((b) => !b.voided).sort((x, y) => y.amount - x.amount)[0];
              return (
                <div key={a.id} className="card" style={{ padding: "10px 14px", display: "flex", justifyContent: "space-between", fontSize: 13 }}>
                  <span>{a.title}</span>
                  <span style={{ opacity: 0.7 }}>
                    {top ? `${profilesById[top.user_id]?.full_name || "..."} · ${fmtMoney(top.amount)}` : "Sin ganador"}
                  </span>
                </div>
              );
            })}
          </div>
          <div style={{ fontSize: 11.5, opacity: 0.5, marginTop: 8 }}>
            Tip: agrupa los últimos ganadores en bloques de 5 y compárteles tu link de Calendly para agendar su visita.
          </div>
        </div>
      )}
    </div>
  );
}

function AuctionAdminCard({ auction, bids, profilesById, onChanged }) {
  const [busy, setBusy] = useState(false);
  const { expired } = timeParts(auction.ends_at);
  const rank = [...bids].filter((b) => !b.voided).sort((a, b) => b.amount - a.amount || new Date(a.created_at) - new Date(b.created_at));
  const confirmExpired = auction.status === "confirming" && auction.confirm_deadline && new Date(auction.confirm_deadline) < new Date();

  async function call(fn, params = {}) {
    setBusy(true);
    const { error } = await supabase.rpc(fn, params);
    setBusy(false);
    if (error) alert(error.message);
    onChanged();
  }

  return (
    <div className="card">
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
        <div>
          <div style={{ fontFamily: "var(--font-display)", fontWeight: 700, fontSize: 16 }}>{auction.title} <span style={{ fontFamily: "var(--font-mono)", fontSize: 11, opacity: 0.4, fontWeight: 400 }}>#{auction.display_id}</span></div>
          <span className="pill" style={{
            background: auction.status === "live" ? (expired ? "#eee" : "var(--salsa)") : "var(--queso)",
            color: auction.status === "live" && !expired ? "white" : "var(--carbon)",
          }}>
            {auction.status === "live" ? (expired ? "Tiempo agotado" : "En vivo") : "Esperando confirmación"}
          </span>
        </div>
        <button className="btn-ghost" style={{ color: "var(--alerta)" }} onClick={() => call("cancel_auction", { p_auction_id: auction.id })} disabled={busy}>
          Cancelar
        </button>
      </div>

      {auction.status === "live" && (
        <div style={{ marginTop: 10 }}>
          <div style={{ fontSize: 13, opacity: 0.7 }}>
            Puja más alta: <b style={{ fontFamily: "var(--font-mono)" }}>{rank[0] ? fmtMoney(rank[0].amount) : fmtMoney(auction.start_price)}</b> ({rank.length} pujas activas)
          </div>
          <button className="btn-primary" style={{ marginTop: 8 }} disabled={!expired || busy} onClick={() => call("close_auction", { p_auction_id: auction.id })}>
            {expired ? "Cerrar subasta y anunciar ganador" : "Se cierra automáticamente al terminar el tiempo"}
          </button>
        </div>
      )}

      {auction.status === "confirming" && (
        <div className="card" style={{ marginTop: 10, background: "var(--queso-claro)" }}>
          <div style={{ fontSize: 14, fontWeight: 700 }}>Ganador: {profilesById[auction.winner_user_id]?.full_name || "..."}</div>
          <div style={{ fontSize: 13, opacity: 0.8 }}>{profilesById[auction.winner_user_id]?.phone || ""}</div>
          <div style={{ fontSize: 12, marginTop: 4, opacity: 0.7 }}>
            {auction.winner_confirmed ? "✅ Ya confirmó su cupo" : "Aún no ha confirmado"}
          </div>
          <div style={{ display: "flex", gap: 8, marginTop: 10 }}>
            <button className="btn-primary" style={{ flex: 1 }} disabled={busy} onClick={() => call("archive_auction", { p_auction_id: auction.id })}>
              <Check size={14} style={{ marginRight: 4 }} /> Archivar (ya coordinado)
            </button>
            <button className="btn-ghost" style={{ flex: 1, borderColor: "var(--alerta)", color: "var(--alerta)" }} disabled={busy} onClick={() => call("pass_to_next", { p_auction_id: auction.id })}>
              Pasar al siguiente
            </button>
          </div>
          {confirmExpired && !auction.winner_confirmed && (
            <div className="error-text" style={{ display: "flex", alignItems: "center", gap: 4 }}>
              <AlertTriangle size={12} /> Venció el tiempo de confirmación
            </div>
          )}
        </div>
      )}

      {bids.length > 0 && (
        <div style={{ marginTop: 12 }}>
          <div style={{ fontSize: 11.5, fontWeight: 700, opacity: 0.6, marginBottom: 6 }}>PUJAS RECIBIDAS</div>
          <div style={{ display: "flex", flexDirection: "column", gap: 4, maxHeight: 220, overflowY: "auto" }}>
            {bids.map((b) => (
              <div key={b.id} style={{
                display: "flex", justifyContent: "space-between", alignItems: "center", padding: "6px 10px", borderRadius: 8,
                background: b.voided ? "#f2f2f2" : "var(--crema-suave)",
                textDecoration: b.voided ? "line-through" : "none", opacity: b.voided ? 0.5 : 1,
              }}>
                <div style={{ fontSize: 12.5 }}>{profilesById[b.user_id]?.full_name || "..."} · {profilesById[b.user_id]?.phone || ""}</div>
                <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <span style={{ fontFamily: "var(--font-mono)", fontSize: 12.5, fontWeight: 700 }}>{fmtMoney(b.amount)}</span>
                  {!b.voided && (
                    <button onClick={() => call("void_bid", { p_bid_id: b.id })} title="Anular puja sospechosa" style={{ background: "none", border: "none", cursor: "pointer", color: "var(--alerta)" }}>
                      <X size={14} />
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function LabeledInput({ label, value, onChange }) {
  return (
    <div style={{ flex: 1 }}>
      <div style={{ fontSize: 10.5, opacity: 0.5, marginBottom: 2 }}>{label}</div>
      <input className="input" type="number" value={value} onChange={(e) => onChange(e.target.value)} />
    </div>
  );
}
