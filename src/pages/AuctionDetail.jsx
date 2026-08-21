import { useEffect, useState, useCallback, useMemo } from "react";
import { useParams, Link } from "react-router-dom";
import { supabase } from "../supabaseClient";
import { useAuth } from "../lib/auth";
import Countdown, { timeParts, useClockTick } from "../components/Countdown";
import { fmtMoney, quickIncrements } from "../components/AuctionCard";
import { waLink, waWinnerMessage, waGeneralMessage } from "../lib/whatsapp";
import { Flame, Clock, Trophy, ShieldCheck, Users } from "lucide-react";

export default function AuctionDetail() {
  const { id } = useParams();
  const { user, profile } = useAuth();
  useClockTick();

  const [auction, setAuction] = useState(null);
  const [bids, setBids] = useState([]);
  const [profilesById, setProfilesById] = useState({});
  const [amount, setAmount] = useState("");
  const [error, setError] = useState("");
  const [ok, setOk] = useState("");
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    const { data: a } = await supabase.from("auctions").select("*").eq("id", id).single();
    setAuction(a);
    const { data: b } = await supabase
      .from("bids").select("*").eq("auction_id", id).order("amount", { ascending: false });
    setBids(b || []);
    const userIds = [...new Set((b || []).map((x) => x.user_id))];
    if (userIds.length) {
      const { data: profs } = await supabase.from("profiles").select("id, full_name").in("id", userIds);
      const map = {};
      (profs || []).forEach((p) => (map[p.id] = p.full_name));
      setProfilesById(map);
    }
  }, [id]);

  useEffect(() => {
    load();
    const channel = supabase
      .channel(`subasta-${id}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "bids", filter: `auction_id=eq.${id}` }, load)
      .on("postgres_changes", { event: "*", schema: "public", table: "auctions", filter: `id=eq.${id}` }, load)
      .subscribe();
    return () => supabase.removeChannel(channel);
  }, [id, load]);

  const rank = useMemo(
    () => [...bids].filter((b) => !b.voided).sort((a, b) => b.amount - a.amount || new Date(a.created_at) - new Date(b.created_at)),
    [bids]
  );
  const topBid = rank[0] || null;

  if (!auction) return <div style={{ textAlign: "center", padding: 60, opacity: 0.6 }}>Cargando subasta...</div>;

  const { expired } = timeParts(auction.ends_at);
  const notStartedYet = new Date(auction.starts_at).getTime() > Date.now();
  const increments = quickIncrements(auction.start_price);
  const minIncrement = increments[0];
  const min = topBid ? topBid.amount + minIncrement : auction.start_price;
  const isWinner = (auction.status === "confirming" || auction.status === "closed") && auction.winner_user_id === user?.id;

  async function placeBid(amt) {
    setError(""); setOk("");
    if (!user) return setError("Inicia sesión para poder pujar.");
    if (!amt || amt < min) return setError(`Tu puja debe ser de al menos ${fmtMoney(min)}.`);
    if (auction.max_price && amt > auction.max_price) return setError(`Esta subasta tiene un tope máximo de ${fmtMoney(auction.max_price)}.`);
    setBusy(true);
    const { error } = await supabase.rpc("place_bid", { p_auction_id: id, p_amount: amt });
    setBusy(false);
    if (error) return setError(error.message.replace("La puja debe ser de al menos", "Tu puja debe ser de al menos"));
    setAmount("");
    setOk("¡Puja registrada! Vas subiendo en el tablero 🔥");
  }

  function submitBid(e) {
    e.preventDefault();
    placeBid(Number(amount));
  }

  function quickBid(step) {
    const base = topBid ? topBid.amount : auction.start_price;
    placeBid(base + step);
  }

  async function confirmWin() {
    setBusy(true); setError("");
    const { error } = await supabase.rpc("confirm_win", { p_auction_id: id });
    setBusy(false);
    if (error) return setError(error.message);
    setOk("¡Confirmado! MrFull te contactará para coordinar tu visita.");
  }

  return (
    <div style={{ maxWidth: 720, margin: "0 auto", padding: "20px 14px 60px" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <Link to="/" style={{ fontSize: 13, opacity: 0.6, textDecoration: "none" }}>← Volver a subastas</Link>
        <span style={{ fontSize: 11, opacity: 0.4, fontFamily: "var(--font-mono)" }}>ID: {auction.display_id}</span>
      </div>

      <div style={{ marginTop: 12, background: "var(--ladrillo)", borderRadius: 20, padding: 6 }}>
        <div style={{ background: "var(--crema)", borderRadius: 15, overflow: "hidden" }}>
          {auction.image_url ? (
            <img src={auction.image_url} alt={auction.title} style={{ width: "100%", height: 200, objectFit: "cover", display: "block" }} />
          ) : (
            <div style={{ width: "100%", height: 140, display: "flex", alignItems: "center", justifyContent: "center", background: "var(--crema-suave)" }}>
              <Flame size={38} color="var(--ladrillo)" />
            </div>
          )}
          <div style={{ padding: "14px 16px 18px" }}>
            <div style={{ fontFamily: "var(--font-display)", fontWeight: 800, fontSize: 22 }}>{auction.title}</div>
            {auction.description && <div style={{ fontSize: 13.5, opacity: 0.75, marginTop: 4 }}>{auction.description}</div>}
          </div>
        </div>
      </div>

      <div className={auction.status === "live" && !expired && !notStartedYet ? "glow" : ""} style={{ background: "var(--carbon)", borderRadius: 18, padding: 18, marginTop: 14, textAlign: "center" }}>
        {auction.status === "live" && notStartedYet && (
          <div style={{ color: "var(--queso)", fontFamily: "var(--font-display)", fontWeight: 700 }}>
            🕒 Empieza el {new Date(auction.starts_at).toLocaleString("es-CO", { dateStyle: "medium", timeStyle: "short" })}
          </div>
        )}
        {auction.status === "live" && !expired && !notStartedYet && (
          <>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 6, color: "var(--queso)", fontSize: 12, fontWeight: 700, textTransform: "uppercase" }}>
              <Clock size={14} /> Cierra en <Countdown endsAt={auction.ends_at} />
            </div>
            <div style={{ fontFamily: "var(--font-mono)", fontWeight: 700, fontSize: 38, color: "var(--texto-sobre-oscuro)", marginTop: 6 }}>
              {topBid ? fmtMoney(topBid.amount) : fmtMoney(auction.start_price)}
            </div>
            <div style={{ fontSize: 13, color: "var(--texto-sobre-oscuro)", opacity: 0.7 }}>
              {topBid ? `Puja más alta — ${profilesById[topBid.user_id] || "..."}` : "Precio inicial · ¡sé el primero en pujar!"}
              {auction.max_price ? ` · Tope máximo: ${fmtMoney(auction.max_price)}` : ""}
            </div>
          </>
        )}
        {auction.status === "live" && expired && !notStartedYet && (
          <div style={{ color: "var(--queso)", fontFamily: "var(--font-display)", fontWeight: 700 }}>
            ⏱️ Tiempo agotado — esperando que MrFull anuncie al ganador
          </div>
        )}
        {(auction.status === "confirming" || auction.status === "closed") && (
          <div>
            <Trophy size={24} color="var(--queso)" />
            <div style={{ fontFamily: "var(--font-display)", fontWeight: 800, fontSize: 18, color: "var(--texto-sobre-oscuro)", marginTop: 6 }}>
              {profilesById[auction.winner_user_id] || "Ganador"} — {fmtMoney(topBid?.amount ?? auction.start_price)}
            </div>
            <div style={{ fontSize: 12.5, color: "var(--texto-sobre-oscuro)", opacity: 0.7, marginTop: 4 }}>
              {auction.status === "confirming"
                ? auction.winner_confirmed ? "Cupo confirmado, esperando cierre de MrFull" : "Esperando que el ganador confirme su cupo"
                : "Subasta cerrada"}
            </div>
          </div>
        )}
      </div>

      {isWinner && (
        <div className="card" style={{ marginTop: 14, background: "var(--queso-claro)" }}>
          <div style={{ fontFamily: "var(--font-display)", fontWeight: 700, marginBottom: 8 }}>
            🎉 ¡Ganaste esta subasta!
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {!auction.winner_confirmed && (
              <button className="btn-primary" onClick={confirmWin} disabled={busy}>Confirmar mi cupo</button>
            )}
            <a
              href={waLink(waWinnerMessage({ title: auction.title, amount: topBid ? topBid.amount : auction.start_price, fullName: profile?.full_name || "" }))}
              target="_blank" rel="noopener noreferrer"
              style={{
                display: "flex", alignItems: "center", justifyContent: "center", gap: 8,
                background: "#25D366", color: "white", borderRadius: 10, padding: "11px 16px",
                fontWeight: 700, fontSize: 14, textDecoration: "none",
              }}
            >
              💬 Escribir por WhatsApp para reclamar mi premio
            </a>
          </div>
        </div>
      )}

      {auction.status === "live" && !expired && !notStartedYet && (
        <form onSubmit={submitBid} className="card" style={{ marginTop: 14 }}>
          <div style={{ fontFamily: "var(--font-display)", fontWeight: 700, fontSize: 16, marginBottom: 10 }}>Haz tu puja</div>
          {!user ? (
            <div style={{ fontSize: 13.5 }}>
              <Link to="/login" style={{ color: "var(--ladrillo)", fontWeight: 700 }}>Inicia sesión</Link> para poder pujar.
            </div>
          ) : (
            <>
              <div style={{ display: "flex", gap: 8, marginBottom: 8 }}>
                {increments.map((step) => {
                  const resultingAmount = (topBid ? topBid.amount : auction.start_price) + step;
                  const exceedsMax = auction.max_price && resultingAmount > auction.max_price;
                  return (
                    <button
                      key={step}
                      type="button"
                      disabled={busy || exceedsMax}
                      onClick={() => quickBid(step)}
                      title={exceedsMax ? `Superaría el tope máximo de ${fmtMoney(auction.max_price)}` : undefined}
                      style={{ flex: 1, background: exceedsMax ? "#ccc" : "var(--salsa)", color: "white", border: "none", borderRadius: 10, padding: "10px 8px", fontWeight: 700, fontSize: 14, cursor: exceedsMax ? "not-allowed" : "pointer" }}
                    >
                      +{fmtMoney(step).replace("$", "")}
                    </button>
                  );
                })}
              </div>
              <div style={{ display: "flex", gap: 8 }}>
                <input className="input" type="number" placeholder={`O escribe un monto (mín. ${fmtMoney(min)})`} value={amount} onChange={(e) => setAmount(e.target.value)} />
                <button className="btn-primary" disabled={busy} type="submit" style={{ whiteSpace: "nowrap" }}>Pujar 🔥</button>
              </div>
            </>
          )}
          {error && <div className="error-text">{error}</div>}
          {ok && <div className="success-text">{ok}</div>}
        </form>
      )}

      {rank.length > 0 && (
        <div style={{ marginTop: 16 }}>
          <div style={{ fontFamily: "var(--font-display)", fontWeight: 700, fontSize: 15, marginBottom: 8, display: "flex", alignItems: "center", gap: 6 }}>
            <Users size={16} /> Pujas ({rank.length})
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            {rank.slice(0, 15).map((b, i) => (
              <div key={b.id} style={{
                display: "flex", justifyContent: "space-between", alignItems: "center",
                background: i === 0 ? "var(--queso-claro)" : "white", borderRadius: 10, padding: "8px 12px",
                border: `1px solid ${i === 0 ? "var(--queso)" : "var(--crema-suave)"}`,
              }}>
                <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <span style={{ fontFamily: "var(--font-mono)", fontSize: 12, opacity: 0.5, width: 18 }}>{i + 1}</span>
                  <span style={{ fontSize: 14, fontWeight: 600 }}>{profilesById[b.user_id] || "..."}</span>
                </div>
                <span style={{ fontFamily: "var(--font-mono)", fontWeight: 700, fontSize: 14, color: i === 0 ? "var(--ladrillo)" : "var(--carbon)" }}>
                  {fmtMoney(b.amount)}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      <div style={{ background: "var(--carbon-suave)", borderRadius: 14, padding: 14, color: "var(--texto-sobre-oscuro)", marginTop: 16 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 6, fontWeight: 700, fontSize: 13, marginBottom: 6, color: "var(--queso)" }}>
          <ShieldCheck size={15} /> Reglas de la subasta
        </div>
        <ul style={{ fontSize: 12.5, lineHeight: 1.6, opacity: 0.85, paddingLeft: 18, margin: 0 }}>
          <li>No se cobra nada al pujar: solo pagas si ganas y confirmas tu cupo.</li>
          <li>Gana quien tenga la puja más alta cuando cierre el tiempo.</li>
          <li>En caso de empate, gana quien pujó primero.</li>
          <li>El ganador tiene un tiempo límite para confirmar; si no confirma, pasa al siguiente postor.</li>
          <li>MrFull puede anular pujas sospechosas o de mala fe.</li>
        </ul>
      </div>
    </div>
  );
}
