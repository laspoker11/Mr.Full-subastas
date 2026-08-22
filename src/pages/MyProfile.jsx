import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { useAuth } from "../lib/auth";
import { supabase } from "../supabaseClient";
import { fmtMoney } from "../components/AuctionCard";
import { Flame } from "lucide-react";

export default function MyProfile() {
  const { user, profile } = useAuth();
  const [rank, setRank] = useState(null);
  const [rows, setRows] = useState([]);
  const [myBids, setMyBids] = useState({});
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!user) return;
    let active = true;

    async function load() {
      setLoading(true);

      const { count: better } = await supabase
        .from("profiles")
        .select("id", { count: "exact", head: true })
        .gt("points", profile?.points ?? 0);
      const { count: total } = await supabase
        .from("profiles")
        .select("id", { count: "exact", head: true });
      if (active) setRank({ position: (better ?? 0) + 1, total: total ?? 0 });

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
        if (active) setMyBids(map);
      }

      if (active) setLoading(false);
    }

    load();
    return () => { active = false; };
  }, [user, profile?.points]);

  if (!user) return null;

  return (
    <div style={{ maxWidth: 720, margin: "0 auto", padding: "20px 14px 60px" }}>
      <div className="card" style={{ textAlign: "center" }}>
        <div style={{ fontFamily: "var(--font-display)", fontWeight: 800, fontSize: 22 }}>{profile?.full_name || "..."}</div>
        <div style={{ fontFamily: "var(--font-mono)", fontWeight: 700, fontSize: 30, color: "var(--ladrillo)", marginTop: 6 }}>
          {profile?.points ?? 0} pts
        </div>
        {rank && (
          <div style={{ fontSize: 12.5, opacity: 0.6, marginTop: 4 }}>
            Puesto #{rank.position} de {rank.total} usuario{rank.total === 1 ? "" : "s"}
          </div>
        )}
      </div>

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
              const running = a.status === "live" || a.status === "confirming";
              const cancelled = a.status === "void";

              return (
                <Link key={p.auction_id} to={`/subasta/${a.id}`} style={{ textDecoration: "none", color: "inherit" }}>
                  <div className="card" style={{ display: "flex", gap: 12, alignItems: "center" }}>
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
                      <div style={{ fontSize: 12, opacity: 0.65, marginTop: 2 }}>
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
    </div>
  );
}
