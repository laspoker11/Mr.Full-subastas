import { useEffect, useState, useCallback } from "react";
import { supabase } from "../supabaseClient";
import { fmtMoney } from "../components/AuctionCard";
import { Trophy, Flame, Medal } from "lucide-react";

export default function Ranking() {
  const [topUsers, setTopUsers] = useState([]);
  const [todayWinners, setTodayWinners] = useState([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    const { data: top } = await supabase
      .from("profiles")
      .select("id, full_name, points, auctions_won, auctions_participated")
      .order("points", { ascending: false })
      .limit(20);
    setTopUsers(top || []);

    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);

    const { data: auctions } = await supabase
      .from("auctions")
      .select("*")
      .eq("status", "closed")
      .not("winner_user_id", "is", null)
      .gte("created_at", todayStart.toISOString())
      .order("created_at", { ascending: false });

    if (auctions && auctions.length) {
      const winnerIds = [...new Set(auctions.map((a) => a.winner_user_id))];
      const { data: winnerProfiles } = await supabase.from("profiles").select("id, full_name").in("id", winnerIds);
      const nameById = {};
      (winnerProfiles || []).forEach((p) => (nameById[p.id] = p.full_name));

      const auctionIds = auctions.map((a) => a.id);
      const { data: bids } = await supabase.from("bids").select("*").in("auction_id", auctionIds).eq("voided", false);
      const topAmountByAuction = {};
      (bids || []).forEach((b) => {
        if (!topAmountByAuction[b.auction_id] || b.amount > topAmountByAuction[b.auction_id]) topAmountByAuction[b.auction_id] = b.amount;
      });

      setTodayWinners(auctions.map((a) => ({ ...a, winnerName: nameById[a.winner_user_id] || "...", amount: topAmountByAuction[a.id] })));
    } else {
      setTodayWinners([]);
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    load();
    const channel = supabase
      .channel("ranking")
      .on("postgres_changes", { event: "*", schema: "public", table: "profiles" }, load)
      .on("postgres_changes", { event: "*", schema: "public", table: "auctions" }, load)
      .subscribe();
    return () => supabase.removeChannel(channel);
  }, [load]);

  if (loading) return <div style={{ textAlign: "center", padding: 60, opacity: 0.6 }}>Cargando ranking...</div>;

  return (
    <div style={{ maxWidth: 720, margin: "0 auto", padding: "20px 14px 60px" }}>
      <div style={{ fontFamily: "var(--font-display)", fontWeight: 800, fontSize: 24, textAlign: "center", marginBottom: 4 }}>
        🏆 Ranking MrFull
      </div>
      <div style={{ textAlign: "center", fontSize: 13, opacity: 0.6, marginBottom: 24 }}>
        2 puntos por participar en una subasta, 30 puntos por ganarla
      </div>

      {todayWinners.length > 0 && (
        <div style={{ marginBottom: 28 }}>
          <div style={{ fontFamily: "var(--font-display)", fontWeight: 700, fontSize: 16, marginBottom: 10, display: "flex", alignItems: "center", gap: 6 }}>
            <Flame size={17} color="var(--ladrillo)" /> Ganadores de hoy ({todayWinners.length})
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            {todayWinners.map((a) => (
              <div key={a.id} className="card" style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "10px 14px" }}>
                <div>
                  <div style={{ fontWeight: 700, fontSize: 14 }}>{a.winnerName}</div>
                  <div style={{ fontSize: 12, opacity: 0.6 }}>{a.title}</div>
                </div>
                <div style={{ fontFamily: "var(--font-mono)", fontWeight: 700, color: "var(--ladrillo)" }}>{fmtMoney(a.amount)}</div>
              </div>
            ))}
          </div>
        </div>
      )}

      <div>
        <div style={{ fontFamily: "var(--font-display)", fontWeight: 700, fontSize: 16, marginBottom: 10, display: "flex", alignItems: "center", gap: 6 }}>
          <Trophy size={17} color="var(--queso)" /> Tabla de posiciones
        </div>
        {topUsers.length === 0 ? (
          <div className="card" style={{ textAlign: "center", padding: 30, opacity: 0.6 }}>
            Todavía nadie tiene puntos — ¡sé el primero en pujar!
          </div>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            {topUsers.map((u, i) => (
              <div key={u.id} className="card" style={{
                display: "flex", alignItems: "center", gap: 12, padding: "10px 14px",
                background: i < 3 ? "var(--queso-claro)" : "white",
              }}>
                <div style={{ width: 28, textAlign: "center", fontWeight: 800, fontFamily: "var(--font-mono)", fontSize: 15, opacity: i < 3 ? 1 : 0.4 }}>
                  {i === 0 ? <Medal size={20} color="#D4AF37" /> : i === 1 ? <Medal size={20} color="#A8A8A8" /> : i === 2 ? <Medal size={20} color="#B08D57" /> : i + 1}
                </div>
                <div style={{ flex: 1 }}>
                  <div style={{ fontWeight: 700, fontSize: 14 }}>{u.full_name}</div>
                  <div style={{ fontSize: 11.5, opacity: 0.6 }}>{u.auctions_won} ganadas · {u.auctions_participated} participadas</div>
                </div>
                <div style={{ fontFamily: "var(--font-mono)", fontWeight: 800, fontSize: 16, color: "var(--ladrillo)" }}>{u.points}</div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
