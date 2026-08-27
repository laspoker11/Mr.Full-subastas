import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { useAuth } from "../lib/auth";
import { useSiteSettings } from "../lib/siteSettings";
import { supabase } from "../supabaseClient";
import { fmtMoney, totalWithCommission } from "../components/AuctionCard";
import { Flame, Zap } from "lucide-react";

const REMATAZO_STATUS_LABEL = { inscrito: "🟡 Inscrito", confirmado: "✅ Confirmaste por WhatsApp", redimido: "🎉 Redimido", cancelado: "🚫 Cancelado" };

export default function MyProfile() {
  const { user, profile } = useAuth();
  const {
    perfil_show_subastas, perfil_show_rematazos, perfil_show_ranking,
    perfil_show_historial, perfil_show_direcciones,
  } = useSiteSettings();

  const [rank, setRank] = useState(null);
  const [rows, setRows] = useState([]);
  const [myBids, setMyBids] = useState({});
  const [rematazoSignups, setRematazoSignups] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!user) return;
    let active = true;

    async function load() {
      setLoading(true);

      const [{ count: better }, { count: total }, { data: participation }, { data: rSignups }] = await Promise.all([
        supabase.from("profiles").select("id", { count: "exact", head: true }).gt("points", profile?.points ?? 0),
        supabase.from("profiles").select("id", { count: "exact", head: true }),
        supabase
          .from("auction_participation")
          .select("auction_id, joined_at, auctions(*)")
          .eq("user_id", user.id)
          .order("joined_at", { ascending: false }),
        supabase
          .from("rematazo_signups")
          .select("*, rematazos(title, price, image_url)")
          .eq("user_id", user.id)
          .order("created_at", { ascending: false }),
      ]);
      if (active) setRank({ position: (better ?? 0) + 1, total: total ?? 0 });

      const list = (participation || []).filter((p) => p.auctions);
      if (active) setRows(list);
      if (active) setRematazoSignups((rSignups || []).filter((s) => s.rematazos));

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
        if (active) setMyBids(map);
      }

      if (active) setLoading(false);
    }

    load();
    return () => { active = false; };
  }, [user, profile?.points]);

  if (!user) return null;

  const wonAuctions = rows.filter((p) => p.auctions.status === "closed" && p.auctions.winner_user_id === user.id && p.auctions.redeemed_at);
  const redeemedRematazos = rematazoSignups.filter((s) => s.status === "redimido");

  const purchases = [
    ...wonAuctions.map((p) => {
      const amount = myBids[p.auction_id] ?? p.auctions.start_price;
      return { date: p.auctions.redeemed_at, label: p.auctions.title, amount: totalWithCommission(amount, p.auctions.commission_percent) };
    }),
    ...redeemedRematazos.map((s) => ({ date: s.redeemed_at, label: s.rematazos.title, amount: s.rematazos.price })),
  ].sort((a, b) => new Date(b.date) - new Date(a.date));

  const direcciones = [...new Set(rematazoSignups.filter((s) => s.entrega_via === "domicilio" && s.direccion).map((s) => s.direccion))];

  return (
    <div style={{ maxWidth: 720, margin: "0 auto", padding: "20px 14px 60px" }}>
      <div className="card" style={{ textAlign: "center" }}>
        <div style={{ fontFamily: "var(--font-display)", fontWeight: 800, fontSize: 22 }}>{profile?.full_name || "..."}</div>
        {perfil_show_ranking && (
          <>
            <div style={{ fontFamily: "var(--font-mono)", fontWeight: 700, fontSize: 30, color: "var(--ladrillo)", marginTop: 6 }}>
              {profile?.points ?? 0} pts
            </div>
            {rank && (
              <div style={{ fontSize: 12.5, opacity: 0.6, marginTop: 4 }}>
                Puesto #{rank.position} de {rank.total} usuario{rank.total === 1 ? "" : "s"}
              </div>
            )}
          </>
        )}
      </div>

      {perfil_show_subastas && (
        <div style={{ display: "flex", gap: 10, marginTop: 14 }}>
          <div className="card" style={{ flex: 1, textAlign: "center" }}>
            <div style={{ fontFamily: "var(--font-mono)", fontWeight: 700, fontSize: 22 }}>{profile?.auctions_participated ?? 0}</div>
            <div style={{ fontSize: 12, opacity: 0.6 }}>Subastas participadas</div>
          </div>
          <div className="card" style={{ flex: 1, textAlign: "center" }}>
            <div style={{ fontFamily: "var(--font-mono)", fontWeight: 700, fontSize: 22, color: "var(--salsa)" }}>{profile?.auctions_won ?? 0}</div>
            <div style={{ fontSize: 12, opacity: 0.6 }}>Subastas ganadas</div>
          </div>
        </div>
      )}

      {perfil_show_subastas && (
        <div style={{ marginTop: 20 }}>
          <div style={{ fontFamily: "var(--font-display)", fontWeight: 700, fontSize: 15, marginBottom: 10 }}>
            Mis subastas
          </div>
          {loading ? (
            <div style={{ textAlign: "center", padding: 30, opacity: 0.6 }}>Cargando...</div>
          ) : rows.length === 0 ? (
            <div className="card" style={{ textAlign: "center", padding: 30, opacity: 0.7 }}>
              Todavía no has participado en ninguna subasta.
            </div>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              {rows.map((p) => {
                const a = p.auctions;
                const iWon = a.status === "closed" && a.winner_user_id === user.id;
                const closedNotWon = a.status === "closed" && a.winner_user_id !== user.id;
                // Ganaste pero todavía no confirmas el cupo — se le muestra
                // aparte del genérico "En curso" para que no pase de largo.
                const needsConfirm = a.status === "confirming" && a.winner_user_id === user.id;
                const running = (a.status === "live" || a.status === "confirming") && !needsConfirm;
                const cancelled = a.status === "void";

                return (
                  <Link key={p.auction_id} to={`/subasta/${a.id}`} style={{ textDecoration: "none", color: "inherit" }}>
                    <div className="card" style={{
                      display: "flex", gap: 12, alignItems: "center",
                      border: needsConfirm ? "2px solid var(--ladrillo)" : "2px solid transparent",
                      background: needsConfirm ? "var(--queso-claro)" : undefined,
                    }}>
                      <div style={{
                        width: 52, height: 52, borderRadius: 10, overflow: "hidden", flexShrink: 0,
                        background: "var(--crema-suave)", display: "flex", alignItems: "center", justifyContent: "center",
                      }}>
                        {a.image_url
                          ? <img src={a.image_url} alt={a.title} style={{ width: "100%", height: "100%", objectFit: "cover" }} />
                          : <Flame size={20} color="var(--ladrillo)" />}
                      </div>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontWeight: 700, fontSize: 14.5 }}>{a.title}</div>
                        <div style={{ fontSize: 12, opacity: needsConfirm ? 1 : 0.65, fontWeight: needsConfirm ? 700 : 400, color: needsConfirm ? "var(--ladrillo)" : "inherit", marginTop: 2 }}>
                          {needsConfirm && "🏆 ¡Ganaste! Entra a confirmar tu cupo"}
                          {running && "🟢 En curso"}
                          {iWon && `🏆 Ganada · ${fmtMoney(myBids[p.auction_id] ?? a.start_price)}`}
                          {closedNotWon && "❌ No ganada"}
                          {cancelled && "🚫 Cancelada"}
                        </div>
                      </div>
                    </div>
                  </Link>
                );
              })}
            </div>
          )}
        </div>
      )}

      {perfil_show_rematazos && (
        <div style={{ marginTop: 20 }}>
          <div style={{ fontFamily: "var(--font-display)", fontWeight: 700, fontSize: 15, marginBottom: 10 }}>
            Mis rematazos
          </div>
          {loading ? (
            <div style={{ textAlign: "center", padding: 30, opacity: 0.6 }}>Cargando...</div>
          ) : rematazoSignups.length === 0 ? (
            <div className="card" style={{ textAlign: "center", padding: 30, opacity: 0.7 }}>
              Todavía no te has inscrito a ningún rematazo. <Link to="/rematazos" style={{ color: "var(--ladrillo)", fontWeight: 700 }}>Ver rematazos</Link>
            </div>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              {rematazoSignups.map((s) => (
                <div key={s.id} className="card" style={{ display: "flex", gap: 12, alignItems: "center" }}>
                  <div style={{
                    width: 52, height: 52, borderRadius: 10, overflow: "hidden", flexShrink: 0,
                    background: "var(--crema-suave)", display: "flex", alignItems: "center", justifyContent: "center",
                  }}>
                    {s.rematazos.image_url
                      ? <img src={s.rematazos.image_url} alt={s.rematazos.title} style={{ width: "100%", height: "100%", objectFit: "cover" }} />
                      : <Zap size={20} color="var(--ladrillo)" />}
                  </div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontWeight: 700, fontSize: 14.5 }}>{s.rematazos.title}</div>
                    <div style={{ fontSize: 12, opacity: 0.65, marginTop: 2 }}>
                      {REMATAZO_STATUS_LABEL[s.status]} · {fmtMoney(s.rematazos.price)}
                      {s.status === "cancelado" && s.cancel_reason ? ` (${s.cancel_reason})` : ""}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {perfil_show_historial && (
        <div style={{ marginTop: 20 }}>
          <div style={{ fontFamily: "var(--font-display)", fontWeight: 700, fontSize: 15, marginBottom: 10 }}>
            Historial de compras
          </div>
          {loading ? (
            <div style={{ textAlign: "center", padding: 30, opacity: 0.6 }}>Cargando...</div>
          ) : purchases.length === 0 ? (
            <div className="card" style={{ textAlign: "center", padding: 30, opacity: 0.7 }}>
              Todavía no has completado ninguna compra.
            </div>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              {purchases.map((p, i) => (
                <div key={i} className="card" style={{ padding: "10px 14px", display: "flex", justifyContent: "space-between", fontSize: 13 }}>
                  <div>
                    <div style={{ fontWeight: 600 }}>{p.label}</div>
                    <div style={{ fontSize: 11, opacity: 0.55 }}>{new Date(p.date).toLocaleDateString("es-CO", { dateStyle: "medium" })}</div>
                  </div>
                  <span style={{ fontFamily: "var(--font-mono)", fontWeight: 700 }}>{fmtMoney(p.amount)}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {perfil_show_direcciones && direcciones.length > 0 && (
        <div style={{ marginTop: 20 }}>
          <div style={{ fontFamily: "var(--font-display)", fontWeight: 700, fontSize: 15, marginBottom: 10 }}>
            Direcciones guardadas
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            {direcciones.map((d, i) => (
              <div key={i} className="card" style={{ padding: "10px 14px", fontSize: 13 }}>{d}</div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
