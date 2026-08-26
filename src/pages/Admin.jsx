import { useEffect, useState, useCallback, useMemo } from "react";
import { supabase } from "../supabaseClient";
import { useAuth } from "../lib/auth";
import { timeParts, useClockTick } from "../components/Countdown";
import { fmtMoney, totalWithCommission } from "../components/AuctionCard";
import { THEMES, applyTheme } from "../lib/themes";
import { useSiteSettings } from "../lib/siteSettings";
import { Plus, X, Check, RefreshCw, AlertTriangle, Clock3, Image as ImageIcon, Package, BarChart3, Zap, Users } from "lucide-react";

const DURATION_UNITS = { min: { label: "Minutos", minValue: 15, toMinutes: 1 }, hora: { label: "Horas", minValue: 1, toMinutes: 60 }, dia: { label: "Días", minValue: 1, toMinutes: 1440 } };

// Dado un lote de user_id, trae nombre + celular de cada uno en 2 consultas
// (perfiles públicos + contact_info privado) — usado por cualquier pestaña
// que necesite mostrar "quién es" detrás de una fila (pujas, inscripciones, ventas).
async function fetchProfilesWithPhones(userIds) {
  if (!userIds.length) return {};
  const { data: profs } = await supabase.from("profiles").select("id, full_name").in("id", userIds);
  const { data: contacts } = await supabase.from("contact_info").select("id, phone").in("id", userIds);
  const phoneById = {};
  (contacts || []).forEach((c) => (phoneById[c.id] = c.phone));
  const map = {};
  (profs || []).forEach((p) => (map[p.id] = { full_name: p.full_name, phone: phoneById[p.id] || "" }));
  return map;
}

// Pide confirmación dos veces antes de una acción que el cliente ya no
// podrá ver — usado para "quitar de la vista pública" subastas y rematazos.
function confirmTwice(msg1, msg2) {
  if (!window.confirm(msg1)) return false;
  if (!window.confirm(msg2)) return false;
  return true;
}

// Sube una imagen al bucket público "site-assets" bajo la ruta dada, con las
// mismas reglas en todos lados (tipo imagen, máximo 5MB) — usado por el
// formulario de subastas, el panel de Diseño y la creación de rematazos.
async function uploadSiteAsset(file, path) {
  if (!file.type.startsWith("image/")) throw new Error("Ese archivo no es una imagen.");
  if (file.size > 5 * 1024 * 1024) throw new Error("La imagen no puede pesar más de 5 MB.");
  const { error } = await supabase.storage.from("site-assets").upload(path, file, { upsert: true });
  if (error) throw new Error("No se pudo subir la imagen: " + error.message);
  const { data } = supabase.storage.from("site-assets").getPublicUrl(path);
  return data.publicUrl;
}

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
  const [tab, setTab] = useState("subastas");
  const [auctions, setAuctions] = useState([]);
  const [templates, setTemplates] = useState([]);
  const [categories, setCategories] = useState([]);
  const [bidsByAuction, setBidsByAuction] = useState({});
  const [profilesById, setProfilesById] = useState({});
  const [rematazos, setRematazos] = useState([]);
  const [rematazoCategories, setRematazoCategories] = useState([]);
  const [rematazoSignups, setRematazoSignups] = useState([]);
  const [rematazoTemplates, setRematazoTemplates] = useState([]);
  const [form, setForm] = useState({
    title: "", description: "", imageUrl: "", startPrice: 25000, maxPrice: "", durationValue: 15, durationUnit: "min", confirmWindowMin: 25,
    categoryId: "", newCategoryName: "",
    startMode: "now", // "now" | "scheduled"
    startAt: "", // datetime-local string
    saveAsTemplate: false,
    repeatAfterClose: 0,
  });
  const [formError, setFormError] = useState("");
  const [saving, setSaving] = useState(false);
  const [creatingCategory, setCreatingCategory] = useState(false);
  const [uploadingAuctionImage, setUploadingAuctionImage] = useState(false);

  const load = useCallback(async () => {
    const { data: a } = await supabase.from("auctions").select("*").order("starts_at", { ascending: false }).limit(80);
    setAuctions(a || []);
    const { data: t } = await supabase.from("auction_templates").select("*").order("created_at", { ascending: false });
    setTemplates(t || []);
    const { data: c } = await supabase.from("auction_categories").select("*").order("name", { ascending: true });
    setCategories(c || []);
    const { data: b } = await supabase.from("bids").select("*").order("created_at", { ascending: false });
    const byAuction = {};
    (b || []).forEach((bid) => {
      byAuction[bid.auction_id] = byAuction[bid.auction_id] || [];
      byAuction[bid.auction_id].push(bid);
    });
    setBidsByAuction(byAuction);

    const { data: rem } = await supabase.from("rematazos").select("*").order("created_at", { ascending: false }).limit(200);
    setRematazos(rem || []);
    const { data: remCats } = await supabase.from("rematazo_categories").select("*").order("name", { ascending: true });
    setRematazoCategories(remCats || []);
    const { data: remSignups } = await supabase.from("rematazo_signups").select("*").order("created_at", { ascending: false });
    setRematazoSignups(remSignups || []);
    const { data: remTemplates } = await supabase.from("rematazo_templates").select("*").order("created_at", { ascending: false });
    setRematazoTemplates(remTemplates || []);

    const userIds = [...new Set([
      ...(b || []).map((x) => x.user_id),
      ...(a || []).filter((x) => x.cancelled_by).map((x) => x.cancelled_by),
      ...(remSignups || []).map((x) => x.user_id),
    ])];
    setProfilesById(await fetchProfilesWithPhones(userIds));
  }, []);

  useEffect(() => {
    load();
    const channel = supabase
      .channel("admin-dashboard")
      .on("postgres_changes", { event: "*", schema: "public", table: "auctions" }, load)
      .on("postgres_changes", { event: "*", schema: "public", table: "bids" }, load)
      .on("postgres_changes", { event: "*", schema: "public", table: "rematazos" }, load)
      .on("postgres_changes", { event: "*", schema: "public", table: "rematazo_signups" }, load)
      .on("postgres_changes", { event: "*", schema: "public", table: "rematazo_templates" }, load)
      .subscribe();
    return () => supabase.removeChannel(channel);
  }, [load]);

  function useTemplate(t) {
    setForm((f) => ({
      ...f, title: t.title, description: t.description, imageUrl: t.image_url,
      startPrice: t.start_price, maxPrice: t.max_price ?? "", durationValue: t.duration_min, durationUnit: "min", confirmWindowMin: t.confirm_window_min,
    }));
  }

  async function deleteTemplate(id) {
    if (!confirm("¿Borrar esta plantilla?")) return;
    const { error } = await supabase.rpc("delete_template", { p_template_id: id });
    if (error) alert(error.message);
    load();
  }

  function hideAuctionFromPublic(id) {
    if (!confirmTwice(
      "¿Quitar esta subasta de la lista pública? Tus clientes ya no la van a ver ahí — tú la sigues viendo aquí en el historial.",
      "¿Confirmas? Esto no se puede deshacer desde la app."
    )) return;
    supabase.rpc("hide_auction_public", { p_auction_id: id }).then(({ error }) => { if (error) alert(error.message); load(); });
  }

  async function uploadAuctionImage(file) {
    if (!file) return;
    setFormError("");
    setUploadingAuctionImage(true);
    try {
      const ext = file.name.split(".").pop();
      const url = await uploadSiteAsset(file, `auctions/${Date.now()}.${ext}`);
      setForm((f) => ({ ...f, imageUrl: url }));
    } catch (err) {
      setFormError(err.message);
    } finally {
      setUploadingAuctionImage(false);
    }
  }

  async function createCategory() {
    if (!form.newCategoryName.trim()) return;
    setCreatingCategory(true);
    const { data, error } = await supabase.rpc("create_category", { p_name: form.newCategoryName.trim() });
    setCreatingCategory(false);
    if (error) return setFormError("No se pudo crear la categoría: " + error.message);
    setForm((f) => ({ ...f, categoryId: data, newCategoryName: "" }));
    load();
  }

  async function createAuction() {
    setFormError("");
    if (!form.title.trim()) return setFormError("Ponle un nombre al producto.");
    if (!form.startPrice || form.startPrice <= 0) return setFormError("El precio inicial debe ser mayor a 0.");
    const unit = DURATION_UNITS[form.durationUnit];
    if (!form.durationValue || Number(form.durationValue) < unit.minValue) {
      return setFormError(`La duración mínima es ${unit.minValue} ${unit.label.toLowerCase()}.`);
    }
    const durationMinTotal = Number(form.durationValue) * unit.toMinutes;
    if (form.startMode === "scheduled" && !form.startAt) return setFormError("Elige la fecha y hora de inicio.");
    const maxPriceValue = form.maxPrice === "" ? null : Number(form.maxPrice);
    if (maxPriceValue !== null && maxPriceValue < Number(form.startPrice)) {
      return setFormError("El precio máximo no puede ser menor al precio inicial.");
    }

    const startsAtISO = form.startMode === "scheduled" ? new Date(form.startAt).toISOString() : new Date().toISOString();

    setSaving(true);

    if (form.saveAsTemplate) {
      await supabase.rpc("save_template", {
        p_title: form.title.trim(), p_description: form.description.trim(), p_image_url: form.imageUrl.trim(),
        p_start_price: Number(form.startPrice), p_duration_min: durationMinTotal, p_confirm_window_min: Number(form.confirmWindowMin) || 25,
        p_max_price: maxPriceValue,
      });
    }

    const { error } = await supabase.rpc("create_auction", {
      p_title: form.title.trim(), p_description: form.description.trim(), p_image_url: form.imageUrl.trim(),
      p_start_price: Number(form.startPrice), p_duration_min: durationMinTotal, p_confirm_window_min: Number(form.confirmWindowMin) || 25,
      p_starts_at: startsAtISO, p_max_price: maxPriceValue, p_repeat_remaining: Number(form.repeatAfterClose) || 0,
      p_category_id: form.categoryId || null,
    });

    setSaving(false);
    if (error) return setFormError("Error al publicar: " + error.message);
    setForm({
      title: "", description: "", imageUrl: "", startPrice: 25000, maxPrice: "", durationValue: 15, durationUnit: "min", confirmWindowMin: 25,
      categoryId: "", newCategoryName: "",
      startMode: "now", startAt: "", saveAsTemplate: false, repeatAfterClose: 0,
    });
    load();
  }

  const now = Date.now();
  const runningAuctions = auctions.filter((a) => (a.status === "live" && new Date(a.starts_at).getTime() <= now) || a.status === "confirming");
  const scheduledAuctions = auctions
    .filter((a) => a.status === "live" && new Date(a.starts_at).getTime() > now)
    .sort((x, y) => new Date(x.starts_at) - new Date(y.starts_at));
  const closedAuctions = auctions.filter((a) => a.status === "closed");
  const cancelledAuctions = auctions.filter((a) => a.status === "void");

  return (
    <div style={{ maxWidth: 760, margin: "0 auto", padding: "20px 14px 60px", display: "flex", flexDirection: "column", gap: 20 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <div style={{ display: "flex", gap: 6, background: "var(--crema-suave)", padding: 4, borderRadius: 10 }}>
          {[["subastas", "Subastas"], ["redimir", "📦 Por redimir"], ["rematazos", "⚡ Rematazos"], ["inscritos-rematazos", "📋 Inscritos"], ["ventas-rematazos", "📊 Ventas rematazos"], ["reporte", "📊 Reporte"], ["usuarios", "Usuarios"], ["diseno", "🎨 Diseño"]].map(([id, label]) => (
            <button key={id} onClick={() => setTab(id)} style={{
              padding: "6px 14px", borderRadius: 8, border: "none", cursor: "pointer",
              fontWeight: 700, fontSize: 13, background: tab === id ? "var(--ladrillo)" : "transparent",
              color: tab === id ? "white" : "var(--carbon)",
            }}>{label}</button>
          ))}
        </div>
        <button onClick={load} className="btn-ghost" style={{ display: "flex", alignItems: "center", gap: 5 }}>
          <RefreshCw size={13} /> Actualizar
        </button>
      </div>

      {tab === "usuarios" ? (
        <AdminUsers />
      ) : tab === "diseno" ? (
        <AdminDesign />
      ) : tab === "redimir" ? (
        <RedeemPanel auctions={auctions} bidsByAuction={bidsByAuction} profilesById={profilesById} onChanged={load} />
      ) : tab === "rematazos" ? (
        <RematazoAdminPanel rematazos={rematazos} categories={rematazoCategories} templates={rematazoTemplates} onChanged={load} />
      ) : tab === "inscritos-rematazos" ? (
        <RematazoSignupsPanel rematazos={rematazos} signups={rematazoSignups} profilesById={profilesById} onChanged={load} />
      ) : tab === "ventas-rematazos" ? (
        <RematazoSalesPanel rematazos={rematazos} signups={rematazoSignups} profilesById={profilesById} />
      ) : tab === "reporte" ? (
        <ReportPanel auctions={auctions} bidsByAuction={bidsByAuction} />
      ) : (
      <>
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

          <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
            {form.imageUrl && (
              <img src={form.imageUrl} alt="Vista previa" style={{ width: 40, height: 40, borderRadius: 8, objectFit: "contain", background: "var(--crema-suave)", flexShrink: 0 }} />
            )}
            <label className="btn-ghost" style={{ cursor: "pointer" }}>
              {uploadingAuctionImage ? "Subiendo..." : "📤 Subir imagen"}
              <input
                type="file" accept="image/*" style={{ display: "none" }} disabled={uploadingAuctionImage}
                onChange={(e) => uploadAuctionImage(e.target.files[0])}
              />
            </label>
            <ImageGalleryPicker folder="auctions" label="subastas" onSelect={(url) => setForm((f) => ({ ...f, imageUrl: url }))} />
          </div>

          <div>
            <div style={{ fontSize: 10.5, opacity: 0.5, marginBottom: 2 }}>Categoría (opcional)</div>
            <div style={{ display: "flex", gap: 6 }}>
              <select className="input" value={form.categoryId} onChange={(e) => setForm({ ...form, categoryId: e.target.value })} style={{ flex: 1 }}>
                <option value="">Sin categoría</option>
                {categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
              <input
                className="input" placeholder="Nueva categoría..." value={form.newCategoryName}
                onChange={(e) => setForm({ ...form, newCategoryName: e.target.value })}
                style={{ flex: 1 }}
              />
              <button type="button" className="btn-ghost" onClick={createCategory} disabled={creatingCategory || !form.newCategoryName.trim()}>
                {creatingCategory ? "..." : "+"}
              </button>
            </div>
          </div>

          <div style={{ display: "flex", gap: 8 }}>
            <LabeledInput label="Precio inicial" value={form.startPrice} onChange={(v) => setForm({ ...form, startPrice: v })} />
            <LabeledInput label="Precio máximo (opcional)" value={form.maxPrice} onChange={(v) => setForm({ ...form, maxPrice: v })} />
            <LabeledInput label="Confirmar (min)" value={form.confirmWindowMin} onChange={(v) => setForm({ ...form, confirmWindowMin: v })} />
          </div>

          <DurationInput
            value={form.durationValue} unit={form.durationUnit}
            onChange={(v, u) => setForm({ ...form, durationValue: v, durationUnit: u })}
          />

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
              </div>
            )}

            <div style={{ borderTop: "1px solid var(--crema-suave)", marginTop: 6, paddingTop: 10 }}>
              <LabeledInput label="Repetir automáticamente X veces después de cerrar" value={form.repeatAfterClose} onChange={(v) => setForm({ ...form, repeatAfterClose: v })} />
              {Number(form.repeatAfterClose) > 0 && (
                <div style={{ fontSize: 11.5, opacity: 0.6, marginTop: 4 }}>
                  Apenas archives esta subasta, se va a crear sola la siguiente igualita (mismo producto, precio y duración) —
                  esto va a pasar {form.repeatAfterClose} {Number(form.repeatAfterClose) === 1 ? "vez" : "veces"} más, sin que tengas que hacer nada.
                </div>
              )}
            </div>
          </div>

          <button className="btn-primary" onClick={createAuction} disabled={saving} style={{ marginTop: 4 }}>
            {saving ? "Publicando..." : form.startMode === "scheduled" ? "Programar subasta" : "Iniciar subasta"}
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
                  onClick={async () => {
                    const reason = window.prompt("¿Por qué vas a cancelar esta subasta programada? (esto queda guardado)");
                    if (reason === null) return;
                    if (!reason.trim()) return alert("Escribe un motivo antes de continuar.");
                    await supabase.rpc("cancel_auction", { p_auction_id: a.id, p_reason: reason.trim() });
                    load();
                  }}
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
                <div key={a.id} className="card" style={{ padding: "10px 14px", display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8, fontSize: 13 }}>
                  <span>{a.title}{a.hidden_public && <span className="pill" style={{ background: "#ddd", color: "var(--carbon)", marginLeft: 6, fontSize: 9.5 }}>OCULTA DEL PÚBLICO</span>}</span>
                  <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                    <span style={{ opacity: 0.7 }}>
                      {top ? `${profilesById[top.user_id]?.full_name || "..."} · ${profilesById[top.user_id]?.phone || ""} · ${fmtMoney(top.amount)}` : "Sin ganador"}
                    </span>
                    {!a.hidden_public && (
                      <button className="btn-ghost" style={{ fontSize: 10.5, padding: "4px 8px", whiteSpace: "nowrap" }} onClick={() => hideAuctionFromPublic(a.id)}>
                        Quitar de público
                      </button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
          <div style={{ fontSize: 11.5, opacity: 0.5, marginTop: 8 }}>
            Tip: agrupa los últimos ganadores en bloques de 5 y compárteles tu link de Calendly para agendar su visita.
          </div>
        </div>
      )}

      {cancelledAuctions.length > 0 && (
        <div>
          <div style={{ fontFamily: "var(--font-display)", fontWeight: 700, fontSize: 15, marginBottom: 10, opacity: 0.7, display: "flex", alignItems: "center", gap: 6 }}>
            <X size={15} color="var(--alerta)" /> Canceladas ({cancelledAuctions.length})
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            {cancelledAuctions.slice(0, 15).map((a) => (
              <div key={a.id} className="card" style={{ padding: "10px 14px", fontSize: 12.5, borderColor: "var(--alerta)" }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8 }}>
                  <span style={{ fontWeight: 700 }}>{a.title}{a.hidden_public && <span className="pill" style={{ background: "#ddd", color: "var(--carbon)", marginLeft: 6, fontSize: 9.5 }}>OCULTA</span>}</span>
                  <span style={{ opacity: 0.6, whiteSpace: "nowrap" }}>
                    {a.cancelled_at && new Date(a.cancelled_at).toLocaleString("es-CO", { dateStyle: "medium", timeStyle: "short" })}
                  </span>
                </div>
                <div style={{ opacity: 0.75, marginTop: 2, display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8 }}>
                  <span>
                    Motivo: {a.cancel_reason || "(sin motivo especificado)"}
                    {a.cancelled_by && ` — canceló ${profilesById[a.cancelled_by]?.full_name || "..."}`}
                  </span>
                  {!a.hidden_public && (
                    <button className="btn-ghost" style={{ fontSize: 10.5, padding: "4px 8px", whiteSpace: "nowrap" }} onClick={() => hideAuctionFromPublic(a.id)}>
                      Quitar de público
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
      </>
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

  function cancelWithReason(auctionId) {
    const reason = window.prompt("¿Por qué vas a cancelar esta subasta? (esto queda guardado)");
    if (reason === null) return; // le dio "Cancelar" al cuadro, no seguimos
    if (!reason.trim()) return alert("Escribe un motivo antes de continuar.");
    call("cancel_auction", { p_auction_id: auctionId, p_reason: reason.trim() });
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
          {auction.repeat_remaining > 0 && (
            <span className="pill" style={{ background: "var(--carbon-suave)", color: "var(--queso)", marginLeft: 6 }}>
              🔁 repite {auction.repeat_remaining} {auction.repeat_remaining === 1 ? "vez" : "veces"} más
            </span>
          )}
        </div>
        <button className="btn-ghost" style={{ color: "var(--alerta)" }} onClick={() => cancelWithReason(auction.id)} disabled={busy}>
          Cancelar
        </button>
      </div>

      {auction.status === "live" && (
        <div style={{ marginTop: 10 }}>
          <div style={{ fontSize: 13, opacity: 0.7 }}>
            Puja más alta: <b style={{ fontFamily: "var(--font-mono)" }}>{rank[0] ? fmtMoney(rank[0].amount) : fmtMoney(auction.start_price)}</b> ({rank.length} pujas activas)
            {auction.max_price && <span> · Tope: <b style={{ fontFamily: "var(--font-mono)" }}>{fmtMoney(auction.max_price)}</b></span>}
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
            {auction.winner_confirmed ? "✅ Ya confirmó su cupo" : `Aún no ha confirmado (postor ${auction.confirm_attempt || 1} de 2)`}
          </div>
          <div style={{ display: "flex", gap: 8, marginTop: 10 }}>
            <button className="btn-primary" style={{ flex: 1 }} disabled={busy} onClick={() => call("archive_auction", { p_auction_id: auction.id })}>
              <Check size={14} style={{ marginRight: 4 }} /> Archivar (ya coordinado)
            </button>
            <button className="btn-ghost" style={{ flex: 1, borderColor: "var(--alerta)", color: "var(--alerta)" }} disabled={busy} onClick={() => call("pass_to_next", { p_auction_id: auction.id })}>
              {(auction.confirm_attempt || 1) >= 2 ? "Cancelar (2do tampoco confirmó)" : "Pasar al siguiente"}
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
  // Precios en pesos colombianos: sin decimales. Si alguien escribe "10.000"
  // pensando en diez mil, un <input type="number"> normal lo interpreta como
  // el decimal 10.000 = 10 — por eso se ignora cualquier punto o coma.
  return (
    <div style={{ flex: 1 }}>
      <div style={{ fontSize: 10.5, opacity: 0.5, marginBottom: 2 }}>{label}</div>
      <input
        className="input" type="text" inputMode="numeric" value={value}
        onChange={(e) => onChange(e.target.value.replace(/[^0-9]/g, ""))}
      />
    </div>
  );
}

function DurationInput({ value, unit, onChange }) {
  const unitInfo = DURATION_UNITS[unit];

  function changeUnit(u) {
    const min = DURATION_UNITS[u].minValue;
    onChange(Math.max(Number(value) || 0, min), u);
  }

  function increment() {
    onChange(Number(value) + 1, unit);
  }

  return (
    <div>
      <div style={{ fontSize: 10.5, opacity: 0.5, marginBottom: 2 }}>Duración (mínimo {unitInfo.minValue} {unitInfo.label.toLowerCase()})</div>
      <div style={{ display: "flex", gap: 6 }}>
        <select className="input" value={unit} onChange={(e) => changeUnit(e.target.value)} style={{ flex: 1 }}>
          {Object.entries(DURATION_UNITS).map(([key, u]) => <option key={key} value={key}>{u.label}</option>)}
        </select>
        <input
          className="input" type="number" min={unitInfo.minValue} value={value}
          onChange={(e) => onChange(e.target.value, unit)}
          style={{ width: 70 }}
        />
        <button type="button" className="btn-ghost" onClick={increment} style={{ padding: "0 16px" }}>+</button>
      </div>
    </div>
  );
}

function AdminUsers() {
  const [users, setUsers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [sortBy, setSortBy] = useState("points");
  const [query, setQuery] = useState("");
  const [expandedId, setExpandedId] = useState(null);

  const load = useCallback(async () => {
    const { data: profs } = await supabase.from("profiles").select("*");
    const { data: contacts } = await supabase.from("contact_info").select("*");
    const phoneById = {};
    (contacts || []).forEach((c) => (phoneById[c.id] = c.phone));
    setUsers((profs || []).map((p) => ({ ...p, phone: phoneById[p.id] || "" })));
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  const filtered = users
    .filter((u) => !query.trim() || u.full_name.toLowerCase().includes(query.toLowerCase()) || u.phone.includes(query))
    .sort((a, b) => (b[sortBy] || 0) - (a[sortBy] || 0));

  return (
    <div className="card">
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10, flexWrap: "wrap", gap: 8 }}>
        <div style={{ fontFamily: "var(--font-display)", fontWeight: 700, fontSize: 16 }}>
          Usuarios registrados ({users.length})
        </div>
        <button onClick={load} className="btn-ghost">Actualizar</button>
      </div>

      <input className="input" placeholder="Buscar por nombre o celular..." value={query} onChange={(e) => setQuery(e.target.value)} style={{ marginBottom: 10 }} />

      <div style={{ display: "flex", gap: 6, marginBottom: 10 }}>
        {[["points", "Puntos"], ["auctions_won", "Ganadas"], ["auctions_participated", "Participaciones"], ["created_at", "Más recientes"]].map(([id, label]) => (
          <button key={id} onClick={() => setSortBy(id)} style={{
            padding: "5px 10px", borderRadius: 8, border: `1px solid ${sortBy === id ? "var(--ladrillo)" : "var(--crema-suave)"}`,
            background: sortBy === id ? "var(--queso-claro)" : "white", fontSize: 11.5, fontWeight: 600, cursor: "pointer",
          }}>{label}</button>
        ))}
      </div>

      {loading ? (
        <div style={{ textAlign: "center", padding: 30, opacity: 0.6 }}>Cargando...</div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
          {filtered.map((u, i) => (
            <div key={u.id}>
              <div
                onClick={() => setExpandedId(expandedId === u.id ? null : u.id)}
                style={{
                  display: "flex", justifyContent: "space-between", alignItems: "center", cursor: "pointer",
                  padding: "10px 12px", borderRadius: 10, background: i === 0 && sortBy === "points" ? "var(--queso-claro)" : "var(--crema-suave)",
                  border: expandedId === u.id ? "2px solid var(--ladrillo)" : "2px solid transparent",
                }}
              >
                <div>
                  <div style={{ fontWeight: 700, fontSize: 13.5, display: "flex", alignItems: "center", gap: 6 }}>
                    {i === 0 && sortBy === "points" && "🏆"} {u.full_name}
                    {u.is_admin && <span className="pill" style={{ background: "var(--carbon)", color: "var(--queso)", fontSize: 9.5 }}>ADMIN</span>}
                  </div>
                  <div style={{ fontSize: 11, opacity: 0.6 }}>
                    {u.phone} · Registrado el {new Date(u.created_at).toLocaleDateString("es-CO", { dateStyle: "medium" })}
                  </div>
                </div>
                <div style={{ textAlign: "right", fontSize: 11.5 }}>
                  <div style={{ fontFamily: "var(--font-mono)", fontWeight: 700, fontSize: 15, color: "var(--ladrillo)" }}>{u.points} pts</div>
                  <div style={{ opacity: 0.6 }}>{u.auctions_won} ganadas · {u.auctions_participated} participadas</div>
                </div>
              </div>
              {expandedId === u.id && <UserDetailPanel user={u} />}
            </div>
          ))}
          {filtered.length === 0 && <div style={{ textAlign: "center", padding: 20, opacity: 0.5, fontSize: 13 }}>Sin resultados</div>}
        </div>
      )}
    </div>
  );
}

// Historial completo de subastas de UN usuario en particular (para que el
// admin lo vea desde la pestaña Usuarios) — misma lógica que /perfil, pero
// mirando a otra persona en vez de al usuario logueado.
function UserDetailPanel({ user }) {
  const [rows, setRows] = useState([]);
  const [userBids, setUserBids] = useState({});
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let active = true;

    async function load() {
      setLoading(true);
      const { data: participation } = await supabase
        .from("auction_participation")
        .select("auction_id, joined_at, auctions(*)")
        .eq("user_id", user.id)
        .order("joined_at", { ascending: false });
      const list = (participation || []).filter((p) => p.auctions);
      if (active) setRows(list);

      const ids = list.map((p) => p.auction_id);
      if (ids.length) {
        const { data: bids } = await supabase
          .from("bids")
          .select("auction_id, amount")
          .eq("user_id", user.id)
          .in("auction_id", ids);
        const map = {};
        (bids || []).forEach((b) => {
          if (!map[b.auction_id] || b.amount > map[b.auction_id]) map[b.auction_id] = b.amount;
        });
        if (active) setUserBids(map);
      }
      if (active) setLoading(false);
    }

    load();
    return () => { active = false; };
  }, [user.id]);

  return (
    <div className="card" style={{ marginTop: 6, marginBottom: 4 }}>
      {loading ? (
        <div style={{ textAlign: "center", padding: 20, opacity: 0.6 }}>Cargando historial...</div>
      ) : rows.length === 0 ? (
        <div style={{ textAlign: "center", padding: 20, opacity: 0.6, fontSize: 13 }}>
          Este usuario todavía no ha participado en ninguna subasta.
        </div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          <div style={{ fontSize: 11.5, fontWeight: 700, opacity: 0.6 }}>HISTORIAL DE SUBASTAS ({rows.length})</div>
          {rows.map((p) => {
            const a = p.auctions;
            const iWon = a.status === "closed" && a.winner_user_id === user.id;
            const closedNotWon = a.status === "closed" && a.winner_user_id !== user.id;
            const running = a.status === "live" || a.status === "confirming";
            const cancelled = a.status === "void";

            return (
              <div key={p.auction_id} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "8px 10px", borderRadius: 8, background: "var(--crema-suave)", fontSize: 13 }}>
                <span>{a.title}</span>
                <span style={{ opacity: 0.75 }}>
                  {running && "🟢 En curso"}
                  {iWon && `🏆 Ganada · ${fmtMoney(userBids[p.auction_id] ?? a.start_price)}`}
                  {closedNotWon && "❌ No ganada"}
                  {cancelled && "🚫 Cancelada"}
                </span>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

function AdminDesign() {
  const {
    theme: activeTheme, logo_url, cover_image_url, commission_percent,
    perfil_show_subastas, perfil_show_rematazos, perfil_show_ranking, perfil_show_historial, perfil_show_direcciones,
    refresh,
  } = useSiteSettings();
  const [selectedTheme, setSelectedTheme] = useState(activeTheme);
  const [logoUrl, setLogoUrl] = useState(logo_url || "");
  const [coverUrl, setCoverUrl] = useState(cover_image_url || "");
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [uploadingLogo, setUploadingLogo] = useState(false);
  const [uploadingCover, setUploadingCover] = useState(false);
  const [uploadError, setUploadError] = useState("");
  const [justSavedKind, setJustSavedKind] = useState(""); // "logo" | "cover" | ""

  const [commission, setCommission] = useState(commission_percent ?? 8);
  const [savingCommission, setSavingCommission] = useState(false);
  const [commissionSaved, setCommissionSaved] = useState(false);
  const [commissionError, setCommissionError] = useState("");

  useEffect(() => { setCommission(commission_percent ?? 8); }, [commission_percent]);

  const [vis, setVis] = useState({
    subastas: perfil_show_subastas, rematazos: perfil_show_rematazos, ranking: perfil_show_ranking,
    historial: perfil_show_historial, direcciones: perfil_show_direcciones,
  });
  const [savingVis, setSavingVis] = useState(false);
  const [visSaved, setVisSaved] = useState(false);

  useEffect(() => {
    setVis({
      subastas: perfil_show_subastas, rematazos: perfil_show_rematazos, ranking: perfil_show_ranking,
      historial: perfil_show_historial, direcciones: perfil_show_direcciones,
    });
  }, [perfil_show_subastas, perfil_show_rematazos, perfil_show_ranking, perfil_show_historial, perfil_show_direcciones]);

  async function saveVisibility() {
    setSavingVis(true); setVisSaved(false);
    const { error } = await supabase.rpc("update_profile_visibility", {
      p_show_subastas: vis.subastas, p_show_rematazos: vis.rematazos, p_show_ranking: vis.ranking,
      p_show_historial: vis.historial, p_show_direcciones: vis.direcciones,
    });
    setSavingVis(false);
    if (error) return alert(error.message);
    setVisSaved(true);
    refresh();
  }

  async function saveCommission() {
    setCommissionError(""); setCommissionSaved(false);
    const value = Number(commission);
    if (!value || value < 5 || value > 10) return setCommissionError("Debe ser un número entre 5 y 10.");
    setSavingCommission(true);
    const { error } = await supabase.rpc("update_commission_percent", { p_percent: value });
    setSavingCommission(false);
    if (error) return setCommissionError(error.message);
    setCommissionSaved(true);
    refresh();
  }

  async function uploadImage(file, kind) {
    setUploadError("");
    if (!file) return;

    const setUploading = kind === "logo" ? setUploadingLogo : setUploadingCover;
    setUploading(true);
    setJustSavedKind("");
    try {
      const ext = file.name.split(".").pop();
      const url = await uploadSiteAsset(file, `${kind}-${Date.now()}.${ext}`);
      if (kind === "logo") setLogoUrl(url);
      else setCoverUrl(url);
      // Guarda de una vez — así no hace falta un segundo clic en "Guardar" para
      // que la foto recién subida quede puesta de verdad (se ve igual en
      // subastas.mrfull.online y en rematazos.mrfull.online, es la misma).
      await saveSettings(kind === "logo" ? { logo: url } : { cover: url });
      setSaved(true);
      setJustSavedKind(kind);
    } catch (err) {
      setUploadError(err.message);
    } finally {
      setUploading(false);
    }
  }

  // Vista previa en vivo: aplica el tema elegido al instante, aunque no lo hayas guardado
  useEffect(() => {
    applyTheme(selectedTheme);
    return () => applyTheme(activeTheme); // si sales sin guardar, vuelve al tema real
  }, [selectedTheme, activeTheme]);

  async function saveSettings({ theme = selectedTheme, logo = logoUrl, cover = coverUrl } = {}) {
    const { error } = await supabase.rpc("update_site_settings", {
      p_theme: theme, p_logo_url: logo.trim(), p_cover_image_url: cover.trim(),
    });
    if (error) throw new Error(error.message);
    refresh();
  }

  async function save() {
    setSaving(true); setSaved(false);
    try {
      await saveSettings();
      setSaved(true);
    } catch (err) {
      alert(err.message);
    }
    setSaving(false);
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>
      <div className="card">
        <div style={{ fontFamily: "var(--font-display)", fontWeight: 700, fontSize: 16, marginBottom: 4 }}>
          Elige el estilo de tu app
        </div>
        <div style={{ fontSize: 12.5, opacity: 0.65, marginBottom: 14 }}>
          Toca una tarjeta para probarla al instante (solo tú la ves así hasta que guardes).
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          {Object.entries(THEMES).map(([key, t]) => (
            <button
              key={key}
              onClick={() => setSelectedTheme(key)}
              style={{
                display: "flex", alignItems: "center", gap: 12, textAlign: "left",
                padding: 14, borderRadius: 14, cursor: "pointer",
                border: selectedTheme === key ? "2px solid var(--ladrillo)" : "2px solid var(--crema-suave)",
                background: "white",
              }}
            >
              <div style={{ display: "flex", flexShrink: 0 }}>
                {t.preview.map((c, i) => (
                  <div key={i} style={{ width: 22, height: 40, background: c, marginLeft: i > 0 ? -6 : 0, borderRadius: 6, border: "2px solid white" }} />
                ))}
              </div>
              <div style={{ flex: 1 }}>
                <div style={{ fontWeight: 700, fontSize: 14, display: "flex", alignItems: "center", gap: 6 }}>
                  {t.label}
                  {selectedTheme === key && <Check size={14} color="var(--salsa)" />}
                </div>
                <div style={{ fontSize: 11.5, opacity: 0.65, marginTop: 2 }}>{t.description}</div>
              </div>
            </button>
          ))}
        </div>
      </div>

      <div className="card">
        <div style={{ fontFamily: "var(--font-display)", fontWeight: 700, fontSize: 16, marginBottom: 10, display: "flex", alignItems: "center", gap: 6 }}>
          <ImageIcon size={16} /> Logo e imagen de portada
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>
          <div>
            <div style={{ fontSize: 11.5, opacity: 0.6, marginBottom: 6 }}>Logo (aparece arriba a la izquierda, junto al nombre)</div>
            <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
              {logoUrl && <img src={logoUrl} alt="Logo actual" style={{ width: 44, height: 44, borderRadius: 10, objectFit: "cover", flexShrink: 0 }} />}
              <label className="btn-ghost" style={{ cursor: "pointer" }}>
                {uploadingLogo ? "Subiendo..." : "Subir imagen"}
                <input type="file" accept="image/*" style={{ display: "none" }} disabled={uploadingLogo}
                  onChange={(e) => uploadImage(e.target.files[0], "logo")} />
              </label>
              {justSavedKind === "logo" && <span className="success-text" style={{ margin: 0 }}>✅ Guardado</span>}
            </div>
            <input className="input" placeholder="...o pega un link directo a una imagen" value={logoUrl} onChange={(e) => setLogoUrl(e.target.value)} style={{ marginTop: 8 }} />
          </div>

          <div>
            <div style={{ fontSize: 11.5, opacity: 0.6, marginBottom: 6 }}>Imagen de portada (banner arriba de la lista de subastas)</div>
            {coverUrl && <img src={coverUrl} alt="Portada actual" style={{ width: "100%", height: 100, borderRadius: 10, objectFit: "cover", marginBottom: 8 }} />}
            <label className="btn-ghost" style={{ cursor: "pointer", display: "inline-block" }}>
              {uploadingCover ? "Subiendo..." : "Subir imagen"}
              <input type="file" accept="image/*" style={{ display: "none" }} disabled={uploadingCover}
                onChange={(e) => uploadImage(e.target.files[0], "cover")} />
            </label>
            {justSavedKind === "cover" && <span className="success-text" style={{ margin: "0 0 0 8px" }}>✅ Guardado</span>}
            <input className="input" placeholder="...o pega un link directo a una imagen" value={coverUrl} onChange={(e) => setCoverUrl(e.target.value)} style={{ marginTop: 8 }} />
          </div>

          {uploadError && <div className="error-text">{uploadError}</div>}
          <div style={{ fontSize: 11, opacity: 0.5 }}>
            Máximo 5 MB por imagen. Al subir un archivo se guarda solo, de una vez. Si en cambio pegas un link, tiene que ser la dirección directa del archivo de imagen (que termine en .jpg, .png, etc.) — un link a una publicación de Facebook o a la página de Google Drive no funciona, tiene que ser el link "directo" a la imagen.
          </div>
        </div>
      </div>

      <button className="btn-primary" onClick={save} disabled={saving}>
        {saving ? "Guardando..." : "Guardar diseño para todos"}
      </button>
      {saved && <div className="success-text">✅ Diseño guardado — ya lo ven todos tus usuarios.</div>}

      <div className="card">
        <div style={{ fontFamily: "var(--font-display)", fontWeight: 700, fontSize: 16, marginBottom: 4 }}>
          Costo de administración
        </div>
        <div style={{ fontSize: 12.5, opacity: 0.65, marginBottom: 14 }}>
          Porcentaje que se suma a la puja ganadora (entre 5% y 10%). Solo afecta subastas que publiques
          después de guardar — las que ya están corriendo o cerradas no cambian.
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <input
            className="input" type="number" min={5} max={10} step={0.5}
            value={commission} onChange={(e) => setCommission(e.target.value)}
            style={{ maxWidth: 100 }}
          />
          <span style={{ fontWeight: 700 }}>%</span>
          <button className="btn-primary" onClick={saveCommission} disabled={savingCommission}>
            {savingCommission ? "Guardando..." : "Guardar"}
          </button>
        </div>
        {commissionError && <div className="error-text" style={{ marginTop: 8 }}>{commissionError}</div>}
        {commissionSaved && <div className="success-text" style={{ marginTop: 8 }}>✅ Comisión actualizada.</div>}
      </div>

      <div className="card">
        <div style={{ fontFamily: "var(--font-display)", fontWeight: 700, fontSize: 16, marginBottom: 4 }}>
          Qué puede ver el cliente en su perfil
        </div>
        <div style={{ fontSize: 12.5, opacity: 0.65, marginBottom: 12 }}>
          Controla qué secciones aparecen en "Mi Perfil" — el panel donde cada cliente ve, en un solo lugar, sus subastas y sus rematazos.
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          {[
            ["subastas", "Mis subastas", "Subastas ganadas y en curso"],
            ["rematazos", "Mis rematazos", "Inscripciones activas e historial"],
            ["ranking", "Ranking y puntos", "Puntos acumulados y posición"],
            ["historial", "Historial de compras", "Montos gastados en subastas y rematazos"],
            ["direcciones", "Direcciones guardadas", "Direcciones usadas en domicilios de rematazos"],
          ].map(([key, label, desc]) => (
            <label key={key} style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13 }}>
              <input type="checkbox" checked={vis[key]} onChange={(e) => setVis((v) => ({ ...v, [key]: e.target.checked }))} />
              <span>
                <span style={{ fontWeight: 700 }}>{label}</span>
                <span style={{ opacity: 0.6 }}> — {desc}</span>
              </span>
            </label>
          ))}
        </div>
        <button className="btn-primary" onClick={saveVisibility} disabled={savingVis} style={{ marginTop: 12 }}>
          {savingVis ? "Guardando..." : "Guardar"}
        </button>
        {visSaved && <div className="success-text" style={{ marginTop: 8 }}>✅ Guardado — ya aplica para todos los clientes.</div>}
      </div>
    </div>
  );
}

// Encuentra la puja ganadora real de una subasta cerrada (por id, con respaldo
// a la más alta no anulada si por alguna razón winner_bid_id no calza)
function winningBid(auction, bidsByAuction) {
  const list = bidsByAuction[auction.id] || [];
  return (
    list.find((b) => b.id === auction.winner_bid_id) ||
    [...list].filter((b) => !b.voided).sort((x, y) => y.amount - x.amount)[0] ||
    null
  );
}

// Mejor puja histórica de una subasta (voided o no), para medir cuánto se
// dejó de vender en una subasta cancelada o vencida sin ganador
function bestBidEver(auction, bidsByAuction) {
  const list = bidsByAuction[auction.id] || [];
  if (!list.length) return null;
  return Math.max(...list.map((b) => b.amount));
}

function RedeemPanel({ auctions, bidsByAuction, profilesById, onChanged }) {
  const [busyId, setBusyId] = useState(null);
  const pending = auctions.filter((a) => a.status === "closed" && a.winner_user_id && !a.redeemed_at);

  async function redeem(auctionId, via) {
    setBusyId(auctionId);
    const { error } = await supabase.rpc("mark_redeemed", { p_auction_id: auctionId, p_redeemed_via: via });
    setBusyId(null);
    if (error) return alert(error.message);
    onChanged();
  }

  if (pending.length === 0) {
    return (
      <div className="card" style={{ textAlign: "center", padding: 40 }}>
        <Package size={26} color="var(--salsa)" />
        <div style={{ fontFamily: "var(--font-display)", fontWeight: 700, fontSize: 16, marginTop: 8 }}>
          No hay premios pendientes por redimir
        </div>
        <div style={{ fontSize: 13, opacity: 0.6, marginTop: 4 }}>
          Todos los ganadores de subastas cerradas ya vinieron a reclamar su premio.
        </div>
      </div>
    );
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
      <div style={{ fontFamily: "var(--font-display)", fontWeight: 700, fontSize: 15 }}>
        Pendientes por redimir ({pending.length})
      </div>
      {pending.map((a) => {
        const win = winningBid(a, bidsByAuction);
        const winner = profilesById[a.winner_user_id];
        const amount = win?.amount ?? a.start_price;
        const total = totalWithCommission(amount, a.commission_percent);
        return (
          <div key={a.id} className="card" style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
            <div>
              <div style={{ fontWeight: 700, fontSize: 15 }}>{a.title}</div>
              <div style={{ fontSize: 12.5, opacity: 0.7 }}>
                {winner?.full_name || "..."} · {winner?.phone || ""}
              </div>
              <div style={{ fontSize: 11.5, opacity: 0.5 }}>
                Ganó el {win ? new Date(win.created_at).toLocaleString("es-CO", { dateStyle: "medium", timeStyle: "short" }) : "..."}
              </div>
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
              <div style={{ textAlign: "right" }}>
                <div style={{ fontFamily: "var(--font-mono)", fontWeight: 700, fontSize: 15, color: "var(--ladrillo)" }}>
                  {fmtMoney(total)}
                </div>
                <div style={{ fontSize: 10.5, opacity: 0.55 }}>
                  puja {fmtMoney(amount)} + {a.commission_percent}%
                </div>
              </div>
              <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                <button className="btn-primary" disabled={busyId === a.id} onClick={() => redeem(a.id, "domicilio")} style={{ fontSize: 12.5, padding: "8px 12px" }}>
                  {busyId === a.id ? "..." : "🛵 Domicilio"}
                </button>
                <button className="btn-primary" disabled={busyId === a.id} onClick={() => redeem(a.id, "local")} style={{ fontSize: 12.5, padding: "8px 12px" }}>
                  {busyId === a.id ? "..." : "🏪 Recogió en el local"}
                </button>
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}

const REPORT_PRESETS = [
  { id: "hoy", label: "Hoy" },
  { id: "semana", label: "Últimos 7 días" },
  { id: "mes", label: "Este mes" },
  { id: "todo", label: "Todo" },
  { id: "custom", label: "Rango" },
];

function reportRange(preset, customFrom, customTo) {
  const now = new Date();
  if (preset === "hoy") {
    const start = new Date(now); start.setHours(0, 0, 0, 0);
    return [start, now];
  }
  if (preset === "semana") {
    const start = new Date(now); start.setDate(start.getDate() - 6); start.setHours(0, 0, 0, 0);
    return [start, now];
  }
  if (preset === "mes") {
    const start = new Date(now.getFullYear(), now.getMonth(), 1);
    return [start, now];
  }
  if (preset === "custom") {
    const start = customFrom ? new Date(customFrom + "T00:00:00") : null;
    const end = customTo ? new Date(customTo + "T23:59:59") : now;
    return [start, end];
  }
  return [null, now]; // "todo"
}

function ReportPanel({ auctions, bidsByAuction }) {
  const [preset, setPreset] = useState("mes");
  const [customFrom, setCustomFrom] = useState("");
  const [customTo, setCustomTo] = useState("");
  const [groupBy, setGroupBy] = useState("dia"); // "dia" | "mes"

  const [rangeStart, rangeEnd] = reportRange(preset, customFrom, customTo);
  const inRange = (a) => {
    const t = new Date(a.starts_at);
    return (!rangeStart || t >= rangeStart) && t <= rangeEnd;
  };
  const filtered = auctions.filter(inRange);

  const soldAuctions = filtered.filter((a) => a.status === "closed" && a.winner_user_id);
  const redeemedAuctions = soldAuctions.filter((a) => a.redeemed_at);
  const failedAuctions = filtered.filter((a) => a.status === "void" || (a.status === "closed" && !a.winner_user_id));

  const amountOf = (a) => winningBid(a, bidsByAuction)?.amount ?? a.start_price;
  const commissionOf = (a) => totalWithCommission(amountOf(a), a.commission_percent) - amountOf(a);

  const soldSum = soldAuctions.reduce((s, a) => s + amountOf(a), 0);
  const redeemedSum = redeemedAuctions.reduce((s, a) => s + amountOf(a), 0);
  const pendingSum = soldSum - redeemedSum;
  const pendingCount = soldAuctions.length - redeemedAuctions.length;
  const commissionSum = redeemedAuctions.reduce((s, a) => s + commissionOf(a), 0);
  const domicilioCount = redeemedAuctions.filter((a) => a.redeemed_via === "domicilio").length;
  const localCount = redeemedAuctions.filter((a) => a.redeemed_via === "local").length;

  const failedWithBids = failedAuctions
    .map((a) => ({ auction: a, best: bestBidEver(a, bidsByAuction) }))
    .filter((x) => x.best !== null);
  const failedSum = failedWithBids.reduce((s, x) => s + x.best, 0);

  const cards = [
    { label: "Vendidas", amount: soldSum, count: soldAuctions.length, color: "var(--salsa)" },
    { label: "Redimidas", amount: redeemedSum, count: redeemedAuctions.length, color: "var(--queso)" },
    { label: "Pendientes por redimir", amount: pendingSum, count: pendingCount, color: "var(--ladrillo)" },
    { label: "Comisión cobrada", amount: commissionSum, count: redeemedAuctions.length, color: "#2e7d32" },
    { label: "Canceladas o vencidas", amount: failedSum, count: failedAuctions.length, color: "var(--alerta)" },
  ];

  // Agrupa las vendidas por día o por mes, más reciente primero
  const groups = {};
  soldAuctions.forEach((a) => {
    const d = new Date(a.starts_at);
    const key = groupBy === "dia"
      ? d.toLocaleDateString("es-CO", { year: "numeric", month: "2-digit", day: "2-digit" })
      : d.toLocaleDateString("es-CO", { year: "numeric", month: "long" });
    if (!groups[key]) groups[key] = { key, sortKey: groupBy === "dia" ? d.toISOString().slice(0, 10) : d.toISOString().slice(0, 7), count: 0, amount: 0, redeemedCount: 0, commission: 0 };
    groups[key].count += 1;
    groups[key].amount += amountOf(a);
    if (a.redeemed_at) {
      groups[key].redeemedCount += 1;
      groups[key].commission += commissionOf(a);
    }
  });
  const groupRows = Object.values(groups).sort((x, y) => y.sortKey.localeCompare(x.sortKey));

  return (
    <div>
      <div style={{ fontFamily: "var(--font-display)", fontWeight: 700, fontSize: 15, marginBottom: 10, display: "flex", alignItems: "center", gap: 6 }}>
        <BarChart3 size={16} /> Reporte financiero
      </div>

      <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 12 }}>
        {REPORT_PRESETS.map((p) => (
          <button
            key={p.id} onClick={() => setPreset(p.id)} className="pill"
            style={{
              border: "none", cursor: "pointer", fontSize: 12, padding: "6px 12px",
              background: preset === p.id ? "var(--ladrillo)" : "var(--crema-suave)",
              color: preset === p.id ? "white" : "var(--carbon)",
            }}
          >
            {p.label}
          </button>
        ))}
      </div>

      {preset === "custom" && (
        <div style={{ display: "flex", gap: 8, marginBottom: 12, alignItems: "center", flexWrap: "wrap" }}>
          <label style={{ fontSize: 12, opacity: 0.7 }}>
            Desde <input className="input" type="date" value={customFrom} onChange={(e) => setCustomFrom(e.target.value)} style={{ marginLeft: 4 }} />
          </label>
          <label style={{ fontSize: 12, opacity: 0.7 }}>
            Hasta <input className="input" type="date" value={customTo} onChange={(e) => setCustomTo(e.target.value)} style={{ marginLeft: 4 }} />
          </label>
        </div>
      )}

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
        {cards.map((c) => (
          <div key={c.label} className="card" style={{ borderLeft: `4px solid ${c.color}` }}>
            <div style={{ fontSize: 11.5, fontWeight: 700, opacity: 0.6, textTransform: "uppercase" }}>{c.label}</div>
            <div style={{ fontFamily: "var(--font-mono)", fontWeight: 700, fontSize: 20, marginTop: 4 }}>{fmtMoney(c.amount)}</div>
            <div style={{ fontSize: 12, opacity: 0.6, marginTop: 2 }}>{c.count} subasta{c.count === 1 ? "" : "s"}</div>
          </div>
        ))}
      </div>

      <div style={{ fontSize: 12, opacity: 0.65, marginTop: 10 }}>
        De las redimidas: 🛵 {domicilioCount} a domicilio · 🏪 {localCount} recogidas en el local
        {redeemedAuctions.length - domicilioCount - localCount > 0 ? ` · ${redeemedAuctions.length - domicilioCount - localCount} sin especificar (redimidas antes de este cambio)` : ""}
      </div>

      <div style={{ marginTop: 20, display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <div style={{ fontFamily: "var(--font-display)", fontWeight: 700, fontSize: 14 }}>Detalle</div>
        <div style={{ display: "flex", gap: 6 }}>
          {[["dia", "Por día"], ["mes", "Por mes"]].map(([id, label]) => (
            <button
              key={id} onClick={() => setGroupBy(id)} className="pill"
              style={{
                border: "none", cursor: "pointer", fontSize: 11.5, padding: "5px 10px",
                background: groupBy === id ? "var(--ladrillo)" : "var(--crema-suave)",
                color: groupBy === id ? "white" : "var(--carbon)",
              }}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      {groupRows.length === 0 ? (
        <div style={{ fontSize: 12.5, opacity: 0.6, marginTop: 8 }}>No hay subastas vendidas en este rango.</div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 6, marginTop: 8 }}>
          {groupRows.map((g) => (
            <div key={g.key} className="card" style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "10px 14px" }}>
              <div>
                <div style={{ fontWeight: 700, fontSize: 13, textTransform: "capitalize" }}>{g.key}</div>
                <div style={{ fontSize: 11, opacity: 0.6 }}>{g.count} vendida{g.count === 1 ? "" : "s"} · {g.redeemedCount} redimida{g.redeemedCount === 1 ? "" : "s"}</div>
              </div>
              <div style={{ textAlign: "right" }}>
                <div style={{ fontFamily: "var(--font-mono)", fontWeight: 700, fontSize: 14 }}>{fmtMoney(g.amount)}</div>
                <div style={{ fontSize: 10.5, opacity: 0.6 }}>comisión: {fmtMoney(g.commission)}</div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// Botón que abre una cuadrícula con las imágenes ya subidas a una carpeta
// del bucket site-assets, para reusarlas sin subirlas de nuevo. Sirve tanto
// para subastas ("auctions") como para rematazos ("rematazos").
function ImageGalleryPicker({ folder, label, onSelect }) {
  const [open, setOpen] = useState(false);
  const [files, setFiles] = useState([]);
  const [loading, setLoading] = useState(false);

  async function loadFiles() {
    setLoading(true);
    const { data, error } = await supabase.storage.from("site-assets").list(folder, {
      limit: 100, sortBy: { column: "created_at", order: "desc" },
    });
    setLoading(false);
    if (error) return alert(error.message);
    setFiles((data || []).filter((f) => f.name && f.id));
  }

  function openGallery() {
    setOpen(true);
    loadFiles();
  }

  function publicUrlFor(name) {
    const { data } = supabase.storage.from("site-assets").getPublicUrl(`${folder}/${name}`);
    return data.publicUrl;
  }

  async function deleteFile(name) {
    if (!confirm("¿Borrar esta imagen de la galería? Esto no se puede deshacer.")) return;
    const { error } = await supabase.storage.from("site-assets").remove([`${folder}/${name}`]);
    if (error) return alert(error.message);
    loadFiles();
  }

  return (
    <>
      <button type="button" className="btn-ghost" onClick={openGallery}>🖼️ Elegir de la galería</button>
      {open && (
        <div
          style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.5)", zIndex: 100, display: "flex", alignItems: "center", justifyContent: "center", padding: 20 }}
          onClick={() => setOpen(false)}
        >
          <div className="card" style={{ maxWidth: 480, width: "100%", maxHeight: "80vh", overflowY: "auto" }} onClick={(e) => e.stopPropagation()}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
              <div style={{ fontFamily: "var(--font-display)", fontWeight: 700, fontSize: 15 }}>Galería de imágenes</div>
              <button onClick={() => setOpen(false)} style={{ background: "none", border: "none", cursor: "pointer", display: "flex" }}>
                <X size={18} />
              </button>
            </div>
            {loading ? (
              <div style={{ textAlign: "center", padding: 30, opacity: 0.6 }}>Cargando...</div>
            ) : files.length === 0 ? (
              <div style={{ textAlign: "center", padding: 30, opacity: 0.6, fontSize: 13 }}>
                Todavía no has subido ninguna imagen de {label || "este tipo"}.
              </div>
            ) : (
              <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 8 }}>
                {files.map((f) => (
                  <div key={f.name} style={{ position: "relative" }}>
                    <img
                      src={publicUrlFor(f.name)}
                      alt={f.name}
                      style={{ width: "100%", height: 80, objectFit: "contain", background: "var(--crema-suave)", borderRadius: 8, cursor: "pointer", border: "2px solid var(--crema-suave)", display: "block" }}
                      onClick={() => { onSelect(publicUrlFor(f.name)); setOpen(false); }}
                    />
                    <button
                      onClick={(e) => { e.stopPropagation(); deleteFile(f.name); }}
                      title="Borrar de la galería"
                      style={{
                        position: "absolute", top: 4, right: 4, background: "var(--alerta)", border: "none", borderRadius: "50%",
                        width: 20, height: 20, color: "white", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", padding: 0,
                      }}
                    >
                      <X size={12} />
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}
    </>
  );
}

// ============================================================
// REMATAZOS: crear varios a la vez (por lote) y gestionar sus inscritos.
// ============================================================

function emptyRematazoDraft() {
  return {
    title: "", description: "", imageUrl: "", categoryId: "",
    price: 9900, oldPrice: "", entregaModo: "mixto", limiteTipo: "ambos",
    cuposMax: 50, durationValue: 45, durationUnit: "min", saveAsTemplate: false,
  };
}

function RematazoAdminPanel({ rematazos, categories, templates, onChanged }) {
  const [batch, setBatch] = useState([emptyRematazoDraft()]);
  const [selectedIdx, setSelectedIdx] = useState(0);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState("");
  const [uploadingPhoto, setUploadingPhoto] = useState(false);
  const [creatingCategory, setCreatingCategory] = useState(false);
  const [newCategoryName, setNewCategoryName] = useState("");

  const draft = batch[selectedIdx];
  function updateDraft(patch) {
    setBatch((b) => b.map((d, i) => (i === selectedIdx ? { ...d, ...patch } : d)));
  }
  function addDraft() {
    setBatch((b) => [...b, emptyRematazoDraft()]);
    setSelectedIdx(batch.length);
  }
  function removeDraft(i) {
    setBatch((b) => b.filter((_, idx) => idx !== i));
    setSelectedIdx((s) => Math.max(0, s >= i ? s - 1 : s));
  }

  async function uploadPhoto(file) {
    if (!file) return;
    setFormError("");
    setUploadingPhoto(true);
    try {
      const ext = file.name.split(".").pop();
      const url = await uploadSiteAsset(file, `rematazos/${Date.now()}.${ext}`);
      updateDraft({ imageUrl: url });
    } catch (err) {
      setFormError(err.message);
    } finally {
      setUploadingPhoto(false);
    }
  }

  async function createCategory() {
    if (!newCategoryName.trim()) return;
    setCreatingCategory(true);
    const { data, error } = await supabase.rpc("create_rematazo_category", { p_name: newCategoryName.trim() });
    setCreatingCategory(false);
    if (error) return setFormError("No se pudo crear la categoría: " + error.message);
    updateDraft({ categoryId: data });
    setNewCategoryName("");
    onChanged();
  }

  function useTemplate(t) {
    updateDraft({
      title: t.title, description: t.description || "", imageUrl: t.image_url || "",
      categoryId: t.category_id || "", price: t.price, oldPrice: t.old_price ?? "",
      entregaModo: t.entrega_modo, limiteTipo: t.limite_tipo,
      cuposMax: t.cupos_max ?? 50, durationValue: t.duracion_min ?? 45, durationUnit: "min",
    });
  }

  async function deleteTemplate(id) {
    if (!confirm("¿Borrar esta plantilla?")) return;
    const { error } = await supabase.rpc("delete_rematazo_template", { p_template_id: id });
    if (error) alert(error.message);
    onChanged();
  }

  function validateDraft(d) {
    if (!d.title.trim()) return "Ponle un nombre al producto.";
    if (!d.price || Number(d.price) <= 0) return "El precio debe ser mayor a 0.";
    if (d.limiteTipo !== "tiempo" && (!d.cuposMax || Number(d.cuposMax) <= 0)) return "Indica cuántos cupos tiene.";
    if (d.limiteTipo !== "cantidad" && (!d.durationValue || Number(d.durationValue) <= 0)) return "Indica la duración.";
    return "";
  }

  async function publishBatch() {
    setFormError("");
    for (const d of batch) {
      const err = validateDraft(d);
      if (err) return setFormError(`"${d.title || "Sin nombre"}": ${err}`);
    }
    setSaving(true);
    for (const d of batch) {
      const unit = DURATION_UNITS[d.durationUnit];
      const durationMin = d.limiteTipo !== "cantidad" ? Number(d.durationValue) * unit.toMinutes : null;
      const cuposMax = d.limiteTipo !== "tiempo" ? Number(d.cuposMax) : null;

      if (d.saveAsTemplate) {
        await supabase.rpc("save_rematazo_template", {
          p_title: d.title.trim(), p_price: Number(d.price), p_entrega_modo: d.entregaModo, p_limite_tipo: d.limiteTipo,
          p_description: d.description.trim(), p_image_url: d.imageUrl, p_category_id: d.categoryId || null,
          p_old_price: d.oldPrice === "" ? null : Number(d.oldPrice), p_cupos_max: cuposMax, p_duracion_min: durationMin,
        });
      }

      const { error } = await supabase.rpc("create_rematazo", {
        p_title: d.title.trim(), p_price: Number(d.price), p_entrega_modo: d.entregaModo, p_limite_tipo: d.limiteTipo,
        p_description: d.description.trim(), p_image_url: d.imageUrl, p_category_id: d.categoryId || null,
        p_old_price: d.oldPrice === "" ? null : Number(d.oldPrice),
        p_cupos_max: cuposMax, p_duracion_min: durationMin,
      });
      if (error) { setSaving(false); return setFormError(`"${d.title}": ${error.message}`); }
    }
    setSaving(false);
    setBatch([emptyRematazoDraft()]);
    setSelectedIdx(0);
    onChanged();
  }

  function cancelWithReason(id) {
    const reason = window.prompt("¿Por qué vas a cancelar este rematazo? (esto queda guardado)");
    if (reason === null) return;
    if (!reason.trim()) return alert("Escribe un motivo antes de continuar.");
    supabase.rpc("cancel_rematazo", { p_rematazo_id: id, p_reason: reason.trim() }).then(({ error }) => {
      if (error) alert(error.message);
      onChanged();
    });
  }

  function hideFromPublic(id) {
    if (!confirmTwice(
      "¿Quitar este rematazo de la lista pública? Tus clientes ya no lo van a ver ahí — tú lo sigues viendo aquí en el historial.",
      "¿Confirmas? Esto no se puede deshacer desde la app."
    )) return;
    supabase.rpc("hide_rematazo_public", { p_rematazo_id: id }).then(({ error }) => { if (error) alert(error.message); onChanged(); });
  }

  const activos = rematazos.filter((r) => r.status === "activo");
  const cerrados = rematazos.filter((r) => r.status === "cerrado");
  const cancelados = rematazos.filter((r) => r.status === "cancelado");

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
      <div className="card">
        <div style={{ fontFamily: "var(--font-display)", fontWeight: 700, fontSize: 16, marginBottom: 4, display: "flex", alignItems: "center", gap: 6 }}>
          <Zap size={16} /> Armar lote de rematazos
        </div>
        <div style={{ fontSize: 12.5, opacity: 0.65, marginBottom: 12 }}>
          Agrega varios productos y publícalos todos juntos.
        </div>

        {templates.length > 0 && (
          <div style={{ marginBottom: 12 }}>
            <div style={{ fontSize: 11.5, fontWeight: 700, opacity: 0.6, marginBottom: 6 }}>PLANTILLAS GUARDADAS</div>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
              {templates.map((t) => (
                <div key={t.id} style={{ display: "flex", alignItems: "center", gap: 4, background: "var(--crema-suave)", borderRadius: 20, padding: "4px 6px 4px 12px" }}>
                  <button onClick={() => useTemplate(t)} style={{ background: "none", border: "none", cursor: "pointer", fontSize: 12.5, fontWeight: 600 }}>
                    {t.title} · {fmtMoney(t.price)}
                  </button>
                  <button onClick={() => deleteTemplate(t.id)} style={{ background: "none", border: "none", cursor: "pointer", color: "var(--alerta)", display: "flex" }}>
                    <X size={12} />
                  </button>
                </div>
              ))}
            </div>
          </div>
        )}

        <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 12 }}>
          {batch.map((d, i) => (
            <div key={i} style={{ display: "flex", alignItems: "center", gap: 4, background: i === selectedIdx ? "var(--queso-claro)" : "var(--crema-suave)", borderRadius: 20, padding: "4px 6px 4px 12px" }}>
              <button onClick={() => setSelectedIdx(i)} style={{ background: "none", border: "none", cursor: "pointer", fontSize: 12.5, fontWeight: 600 }}>
                {d.title || `Rematazo ${i + 1}`}
              </button>
              {batch.length > 1 && (
                <button onClick={() => removeDraft(i)} style={{ background: "none", border: "none", cursor: "pointer", color: "var(--alerta)", display: "flex" }}>
                  <X size={12} />
                </button>
              )}
            </div>
          ))}
          <button className="btn-ghost" onClick={addDraft}>+ Agregar otro</button>
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          <input className="input" placeholder="Producto (ej: Salchipapa Clásica)" value={draft.title} onChange={(e) => updateDraft({ title: e.target.value })} />
          <input className="input" placeholder="Descripción corta (opcional)" value={draft.description} onChange={(e) => updateDraft({ description: e.target.value })} />

          <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
            {draft.imageUrl && (
              <img src={draft.imageUrl} alt="Vista previa" style={{ width: 40, height: 40, borderRadius: 8, objectFit: "cover", flexShrink: 0 }} />
            )}
            <label className="btn-ghost" style={{ cursor: "pointer" }}>
              {uploadingPhoto ? "Subiendo..." : "📤 Subir foto"}
              <input type="file" accept="image/*" style={{ display: "none" }} disabled={uploadingPhoto} onChange={(e) => uploadPhoto(e.target.files[0])} />
            </label>
            <ImageGalleryPicker folder="rematazos" label="rematazos" onSelect={(url) => updateDraft({ imageUrl: url })} />
          </div>

          <div>
            <div style={{ fontSize: 10.5, opacity: 0.5, marginBottom: 2 }}>Categoría</div>
            <div style={{ display: "flex", gap: 6 }}>
              <select className="input" value={draft.categoryId} onChange={(e) => updateDraft({ categoryId: e.target.value })} style={{ flex: 1 }}>
                <option value="">Sin categoría</option>
                {categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
              <input className="input" placeholder="Nueva categoría..." value={newCategoryName} onChange={(e) => setNewCategoryName(e.target.value)} style={{ flex: 1 }} />
              <button type="button" className="btn-ghost" onClick={createCategory} disabled={creatingCategory || !newCategoryName.trim()}>
                {creatingCategory ? "..." : "+"}
              </button>
            </div>
          </div>

          <div style={{ display: "flex", gap: 8 }}>
            <LabeledInput label="Precio de rematazo" value={draft.price} onChange={(v) => updateDraft({ price: v })} />
            <LabeledInput label="Precio antes (opcional)" value={draft.oldPrice} onChange={(v) => updateDraft({ oldPrice: v })} />
          </div>

          <div>
            <div style={{ fontSize: 10.5, opacity: 0.5, marginBottom: 2 }}>Modo de entrega</div>
            <select className="input" value={draft.entregaModo} onChange={(e) => updateDraft({ entregaModo: e.target.value })}>
              <option value="mixto">Domicilio y local</option>
              <option value="domicilio">Solo domicilio</option>
              <option value="local">Solo recoger en el local</option>
            </select>
          </div>

          <div>
            <div style={{ fontSize: 10.5, opacity: 0.5, marginBottom: 2 }}>¿Cómo se limita?</div>
            <select className="input" value={draft.limiteTipo} onChange={(e) => updateDraft({ limiteTipo: e.target.value })}>
              <option value="ambos">Por tiempo y por cantidad (lo que llegue primero)</option>
              <option value="tiempo">Solo por tiempo</option>
              <option value="cantidad">Solo por cantidad de personas</option>
            </select>
          </div>

          {draft.limiteTipo !== "tiempo" && (
            <LabeledInput label="Cupos máximos" value={draft.cuposMax} onChange={(v) => updateDraft({ cuposMax: v })} />
          )}
          {draft.limiteTipo !== "cantidad" && (
            <DurationInput value={draft.durationValue} unit={draft.durationUnit} onChange={(v, u) => updateDraft({ durationValue: v, durationUnit: u })} />
          )}

          <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12.5, marginTop: 2 }}>
            <input type="checkbox" checked={draft.saveAsTemplate} onChange={(e) => updateDraft({ saveAsTemplate: e.target.checked })} />
            Guardar "{draft.title || "este rematazo"}" como plantilla (para reusar después)
          </label>

          <button className="btn-primary" onClick={publishBatch} disabled={saving} style={{ marginTop: 4 }}>
            {saving ? "Publicando..." : `Publicar lote (${batch.length})`}
          </button>
          {formError && <div className="error-text" style={{ display: "flex", alignItems: "center", gap: 5 }}><AlertTriangle size={13} /> {formError}</div>}
        </div>
      </div>

      {activos.length > 0 && (
        <div>
          <div style={{ fontFamily: "var(--font-display)", fontWeight: 700, fontSize: 15, marginBottom: 10 }}>Activos ahora ({activos.length})</div>
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            {activos.map((r) => (
              <div key={r.id} className="card" style={{ padding: "10px 14px", display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                <div>
                  <div style={{ fontWeight: 700, fontSize: 13.5 }}>
                    {r.title} <span style={{ fontFamily: "var(--font-mono)", fontSize: 11, opacity: 0.4, fontWeight: 400 }}>#{r.display_id}</span>
                  </div>
                  <div style={{ fontSize: 11.5, opacity: 0.6 }}>
                    {fmtMoney(r.price)} · {r.limite_tipo !== "tiempo" ? `${r.cupos_usados}/${r.cupos_max} cupos` : `${r.cupos_usados} inscritos`}
                    {r.limite_tipo !== "cantidad" && r.ends_at ? ` · cierra ${new Date(r.ends_at).toLocaleString("es-CO", { dateStyle: "medium", timeStyle: "short" })}` : ""}
                  </div>
                </div>
                <button className="btn-ghost" style={{ color: "var(--alerta)" }} onClick={() => cancelWithReason(r.id)}>Cancelar</button>
              </div>
            ))}
          </div>
        </div>
      )}

      {cerrados.length > 0 && (
        <div>
          <div style={{ fontFamily: "var(--font-display)", fontWeight: 700, fontSize: 15, marginBottom: 10, opacity: 0.7 }}>Cerrados ({cerrados.length})</div>
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            {cerrados.slice(0, 15).map((r) => (
              <div key={r.id} className="card" style={{ padding: "10px 14px", display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8, fontSize: 13 }}>
                <span>{r.title}{r.hidden_public && <span className="pill" style={{ background: "#ddd", color: "var(--carbon)", marginLeft: 6, fontSize: 9.5 }}>OCULTO</span>}</span>
                <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <span style={{ opacity: 0.7, whiteSpace: "nowrap" }}>{r.cupos_usados} inscritos · {fmtMoney(r.price)}</span>
                  {!r.hidden_public && (
                    <button className="btn-ghost" style={{ fontSize: 10.5, padding: "4px 8px", whiteSpace: "nowrap" }} onClick={() => hideFromPublic(r.id)}>
                      Quitar de público
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {cancelados.length > 0 && (
        <div>
          <div style={{ fontFamily: "var(--font-display)", fontWeight: 700, fontSize: 15, marginBottom: 10, opacity: 0.7, display: "flex", alignItems: "center", gap: 6 }}>
            <X size={15} color="var(--alerta)" /> Cancelados ({cancelados.length})
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            {cancelados.slice(0, 15).map((r) => (
              <div key={r.id} className="card" style={{ padding: "10px 14px", fontSize: 12.5, borderColor: "var(--alerta)" }}>
                <div style={{ fontWeight: 700 }}>{r.title}{r.hidden_public && <span className="pill" style={{ background: "#ddd", color: "var(--carbon)", marginLeft: 6, fontSize: 9.5 }}>OCULTO</span>}</div>
                <div style={{ opacity: 0.75, marginTop: 2, display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8 }}>
                  <span>Motivo: {r.cancel_reason || "(sin motivo especificado)"}</span>
                  {!r.hidden_public && (
                    <button className="btn-ghost" style={{ fontSize: 10.5, padding: "4px 8px", whiteSpace: "nowrap" }} onClick={() => hideFromPublic(r.id)}>
                      Quitar de público
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

const REMATAZO_STATUS_LABEL = { inscrito: "🟡 Inscrito", confirmado: "✅ Confirmó por WhatsApp", redimido: "🎉 Redimido", cancelado: "🚫 Cancelado" };

function RematazoSignupsPanel({ rematazos, signups, profilesById, onChanged }) {
  const [selectedId, setSelectedId] = useState("");
  const [busyId, setBusyId] = useState(null);

  useEffect(() => {
    if (!selectedId && rematazos.length) setSelectedId(rematazos[0].id);
  }, [rematazos, selectedId]);

  async function redeem(signupId, via) {
    setBusyId(signupId);
    const { error } = await supabase.rpc("mark_rematazo_redeemed", { p_signup_id: signupId, p_entrega_via: via });
    setBusyId(null);
    if (error) return alert(error.message);
    onChanged();
  }

  function kickWithReason(signupId) {
    const reason = window.prompt("¿Por qué vas a sacar a esta persona del cupo? (ej: sin cobertura de domicilio — esto queda guardado)");
    if (reason === null) return;
    if (!reason.trim()) return alert("Escribe un motivo antes de continuar.");
    setBusyId(signupId);
    supabase.rpc("cancel_rematazo_signup", { p_signup_id: signupId, p_reason: reason.trim() }).then(({ error }) => {
      setBusyId(null);
      if (error) return alert(error.message);
      onChanged();
    });
  }

  const signupsForSelected = signups.filter((s) => s.rematazo_id === selectedId);
  const activeSignups = signupsForSelected.filter((s) => s.status !== "cancelado");
  const cancelledSignups = signupsForSelected.filter((s) => s.status === "cancelado");

  return (
    <div className="card">
      <div style={{ fontFamily: "var(--font-display)", fontWeight: 700, fontSize: 16, marginBottom: 10, display: "flex", alignItems: "center", gap: 6 }}>
        <Users size={16} /> Inscritos por rematazo
      </div>

      {rematazos.length === 0 ? (
        <div style={{ textAlign: "center", padding: 30, opacity: 0.6, fontSize: 13 }}>Todavía no has publicado ningún rematazo.</div>
      ) : (
        <>
          <select className="input" value={selectedId} onChange={(e) => setSelectedId(e.target.value)} style={{ marginBottom: 14 }}>
            {rematazos.map((r) => <option key={r.id} value={r.id}>{r.title} — {r.cupos_usados} inscritos</option>)}
          </select>

          {activeSignups.length === 0 ? (
            <div style={{ textAlign: "center", padding: 30, opacity: 0.6, fontSize: 13 }}>Nadie inscrito todavía en este rematazo.</div>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              {activeSignups.map((s) => {
                const u = profilesById[s.user_id];
                return (
                  <div key={s.id} className="card" style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
                    <div>
                      <div style={{ fontWeight: 700, fontSize: 13.5 }}>{u?.full_name || "..."}</div>
                      <div style={{ fontSize: 11.5, opacity: 0.7 }}>{u?.phone || ""}</div>
                      <div style={{ fontSize: 11.5, opacity: 0.6, marginTop: 2 }}>
                        {s.entrega_via === "domicilio" ? `🛵 ${s.direccion}` : "🏪 Recoge en el local"}
                      </div>
                      <div style={{ fontSize: 11, opacity: 0.55, marginTop: 2 }}>{REMATAZO_STATUS_LABEL[s.status]}</div>
                    </div>
                    <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                      {s.status === "confirmado" && (
                        <>
                          <button className="btn-primary" disabled={busyId === s.id} onClick={() => redeem(s.id, "domicilio")} style={{ fontSize: 12.5, padding: "8px 12px" }}>
                            {busyId === s.id ? "..." : "🛵 Domicilio"}
                          </button>
                          <button className="btn-primary" disabled={busyId === s.id} onClick={() => redeem(s.id, "local")} style={{ fontSize: 12.5, padding: "8px 12px" }}>
                            {busyId === s.id ? "..." : "🏪 Recogió en el local"}
                          </button>
                        </>
                      )}
                      {s.status !== "redimido" && (
                        <button
                          className="btn-ghost" disabled={busyId === s.id} onClick={() => kickWithReason(s.id)}
                          style={{ fontSize: 12.5, padding: "8px 12px", borderColor: "var(--alerta)", color: "var(--alerta)" }}
                        >
                          Sacar (sin cobertura)
                        </button>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}

          {cancelledSignups.length > 0 && (
            <div style={{ marginTop: 16 }}>
              <div style={{ fontSize: 11.5, fontWeight: 700, opacity: 0.6, marginBottom: 6 }}>SACADOS DEL CUPO ({cancelledSignups.length})</div>
              <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                {cancelledSignups.map((s) => (
                  <div key={s.id} style={{ fontSize: 12, opacity: 0.7, padding: "6px 10px", borderRadius: 8, background: "var(--crema-suave)" }}>
                    {profilesById[s.user_id]?.full_name || "..."} — {s.cancel_reason || "sin motivo"}
                  </div>
                ))}
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}

// Ventas de rematazos: por producto y por usuario, con el mismo filtro de
// fechas (Hoy/7 días/Mes/Rango) que ya usa el Reporte de subastas.
function RematazoSalesPanel({ rematazos, signups, profilesById }) {
  const [preset, setPreset] = useState("mes");
  const [customFrom, setCustomFrom] = useState("");
  const [customTo, setCustomTo] = useState("");
  const [view, setView] = useState("producto");
  const [expandedUser, setExpandedUser] = useState(null);

  const rematazosById = useMemo(() => {
    const map = {};
    rematazos.forEach((r) => (map[r.id] = r));
    return map;
  }, [rematazos]);

  // Solo cuentan como venta las inscripciones activas de rematazos que
  // siguen en pie (si el admin canceló el rematazo completo, esas
  // inscripciones ya no deberían sumar al total).
  const sales = useMemo(
    () => signups
      .filter((s) => s.status !== "cancelado")
      .map((s) => ({ ...s, rematazo: rematazosById[s.rematazo_id] }))
      .filter((s) => s.rematazo && s.rematazo.status !== "cancelado"),
    [signups, rematazosById]
  );

  const { kpis, productRows, maxIngresos, userRows } = useMemo(() => {
    const [rangeStart, rangeEnd] = reportRange(preset, customFrom, customTo);
    const filtered = sales.filter((s) => {
      const t = new Date(s.created_at);
      return (!rangeStart || t >= rangeStart) && t <= rangeEnd;
    });

    const total = filtered.reduce((s, x) => s + x.rematazo.price, 0);
    const productIds = new Set(filtered.map((s) => s.rematazo_id));
    const buyerIds = new Set(filtered.map((s) => s.user_id));
    const avg = filtered.length ? Math.round(total / filtered.length) : 0;

    const byProduct = {};
    filtered.forEach((s) => {
      if (!byProduct[s.rematazo_id]) byProduct[s.rematazo_id] = { id: s.rematazo_id, title: s.rematazo.title, unidades: 0, ingresos: 0 };
      byProduct[s.rematazo_id].unidades += 1;
      byProduct[s.rematazo_id].ingresos += s.rematazo.price;
    });
    const productRowsSorted = Object.values(byProduct).sort((a, b) => b.ingresos - a.ingresos);

    const byUser = {};
    filtered.forEach((s) => {
      if (!byUser[s.user_id]) byUser[s.user_id] = { items: [], total: 0 };
      byUser[s.user_id].items.push(s);
      byUser[s.user_id].total += s.rematazo.price;
    });
    const userRowsSorted = Object.entries(byUser).map(([uid, v]) => ({ uid, ...v, u: profilesById[uid] })).sort((a, b) => b.total - a.total);

    return {
      kpis: [
        { label: "Total vendido", value: fmtMoney(total) },
        { label: "Rematazos con ventas", value: productIds.size },
        { label: "Personas que compraron", value: buyerIds.size },
        { label: "Ticket promedio", value: fmtMoney(avg) },
      ],
      productRows: productRowsSorted,
      maxIngresos: productRowsSorted.length ? productRowsSorted[0].ingresos : 1,
      userRows: userRowsSorted,
    };
  }, [sales, preset, customFrom, customTo, profilesById]);

  return (
    <div>
      <div style={{ fontFamily: "var(--font-display)", fontWeight: 700, fontSize: 15, marginBottom: 10, display: "flex", alignItems: "center", gap: 6 }}>
        <BarChart3 size={16} /> Ventas de rematazos
      </div>

      <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 12 }}>
        {REPORT_PRESETS.map((p) => (
          <button
            key={p.id} onClick={() => setPreset(p.id)} className="pill"
            style={{
              border: "none", cursor: "pointer", fontSize: 12, padding: "6px 12px",
              background: preset === p.id ? "var(--ladrillo)" : "var(--crema-suave)",
              color: preset === p.id ? "white" : "var(--carbon)",
            }}
          >
            {p.label}
          </button>
        ))}
      </div>

      {preset === "custom" && (
        <div style={{ display: "flex", gap: 8, marginBottom: 12, alignItems: "center", flexWrap: "wrap" }}>
          <label style={{ fontSize: 12, opacity: 0.7 }}>
            Desde <input className="input" type="date" value={customFrom} onChange={(e) => setCustomFrom(e.target.value)} style={{ marginLeft: 4 }} />
          </label>
          <label style={{ fontSize: 12, opacity: 0.7 }}>
            Hasta <input className="input" type="date" value={customTo} onChange={(e) => setCustomTo(e.target.value)} style={{ marginLeft: 4 }} />
          </label>
        </div>
      )}

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginBottom: 16 }}>
        {kpis.map((k) => (
          <div key={k.label} className="card">
            <div style={{ fontSize: 11, fontWeight: 700, opacity: 0.6, textTransform: "uppercase" }}>{k.label}</div>
            <div style={{ fontFamily: "var(--font-mono)", fontWeight: 700, fontSize: 18, marginTop: 4 }}>{k.value}</div>
          </div>
        ))}
      </div>

      <div style={{ display: "flex", gap: 6, marginBottom: 12 }}>
        {[["producto", "Por producto"], ["usuario", "Por usuario"]].map(([id, label]) => (
          <button
            key={id} onClick={() => setView(id)} className="pill"
            style={{
              border: "none", cursor: "pointer", fontSize: 12, padding: "6px 12px",
              background: view === id ? "var(--ladrillo)" : "var(--crema-suave)",
              color: view === id ? "white" : "var(--carbon)",
            }}
          >
            {label}
          </button>
        ))}
      </div>

      {view === "producto" ? (
        productRows.length === 0 ? (
          <div style={{ fontSize: 12.5, opacity: 0.6 }}>No hay ventas en este rango de fechas.</div>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            {productRows.map((r) => (
              <div key={r.id} className="card" style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10 }}>
                <div style={{ flex: 1 }}>
                  <div style={{ fontWeight: 700, fontSize: 13.5 }}>{r.title}</div>
                  <div style={{ height: 6, borderRadius: 999, background: "var(--crema-suave)", overflow: "hidden", marginTop: 6 }}>
                    <div style={{ width: `${Math.max(6, Math.round((r.ingresos / maxIngresos) * 100))}%`, height: "100%", background: "var(--ladrillo)" }} />
                  </div>
                </div>
                <div style={{ textAlign: "right" }}>
                  <div style={{ fontFamily: "var(--font-mono)", fontWeight: 700, fontSize: 14 }}>{fmtMoney(r.ingresos)}</div>
                  <div style={{ fontSize: 11, opacity: 0.6 }}>{r.unidades} unidad{r.unidades === 1 ? "" : "es"}</div>
                </div>
              </div>
            ))}
          </div>
        )
      ) : userRows.length === 0 ? (
        <div style={{ fontSize: 12.5, opacity: 0.6 }}>No hay compras en este rango de fechas.</div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          {userRows.map((r) => (
            <div key={r.uid}>
              <div
                className="card" onClick={() => setExpandedUser(expandedUser === r.uid ? null : r.uid)}
                style={{ display: "flex", justifyContent: "space-between", alignItems: "center", cursor: "pointer" }}
              >
                <div>
                  <div style={{ fontWeight: 700, fontSize: 13.5 }}>{r.u?.full_name || "..."}</div>
                  <div style={{ fontSize: 11.5, opacity: 0.6 }}>{r.u?.phone || ""} · {r.items.length} compra{r.items.length === 1 ? "" : "s"}</div>
                </div>
                <div style={{ fontFamily: "var(--font-mono)", fontWeight: 700, fontSize: 14 }}>{fmtMoney(r.total)}</div>
              </div>
              {expandedUser === r.uid && (
                <div className="card" style={{ marginTop: 4 }}>
                  {r.items.map((it) => (
                    <div key={it.id} style={{ display: "flex", justifyContent: "space-between", fontSize: 12.5, padding: "4px 0" }}>
                      <span>{new Date(it.created_at).toLocaleDateString("es-CO", { dateStyle: "medium" })} · {it.rematazo.title}</span>
                      <span style={{ fontFamily: "var(--font-mono)" }}>{fmtMoney(it.rematazo.price)}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
