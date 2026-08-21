import { useEffect, useState, useCallback } from "react";
import { supabase } from "../supabaseClient";
import AuctionCard from "../components/AuctionCard";
import { useSiteSettings } from "../lib/siteSettings";
import { Flame } from "lucide-react";

export default function Cliente() {
  const { cover_image_url } = useSiteSettings();
  const [auctions, setAuctions] = useState([]);
  const [topAmounts, setTopAmounts] = useState({});
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    const { data: auctionRows, error } = await supabase
      .from("auctions")
      .select("*")
      .neq("status", "void")
      .order("starts_at", { ascending: true })
      .limit(30);
    if (error) { console.error(error); setLoading(false); return; }
    setAuctions(auctionRows || []);

    const { data: bidRows } = await supabase
      .from("bids")
      .select("auction_id, amount")
      .eq("voided", false);
    const tops = {};
    (bidRows || []).forEach((b) => {
      if (!tops[b.auction_id] || b.amount > tops[b.auction_id]) tops[b.auction_id] = b.amount;
    });
    setTopAmounts(tops);
    setLoading(false);
  }, []);

  useEffect(() => {
    load();
    // tiempo real: cualquier cambio en subastas o pujas refresca la lista
    const channel = supabase
      .channel("cliente-lista")
      .on("postgres_changes", { event: "*", schema: "public", table: "auctions" }, load)
      .on("postgres_changes", { event: "*", schema: "public", table: "bids" }, load)
      .subscribe();
    return () => supabase.removeChannel(channel);
  }, [load]);

  const now = Date.now();
  const live = auctions.filter((a) => (a.status === "live" && new Date(a.starts_at).getTime() <= now) || a.status === "confirming");
  const upcoming = auctions.filter((a) => a.status === "live" && new Date(a.starts_at).getTime() > now);
  const closed = auctions.filter((a) => a.status === "closed");

  return (
    <div style={{ maxWidth: 720, margin: "0 auto", padding: "20px 14px 60px" }}>
      {cover_image_url && (
        <img
          src={cover_image_url} alt="MrFull"
          style={{ width: "100%", height: 160, objectFit: "cover", borderRadius: 16, marginBottom: 18 }}
        />
      )}
      {loading ? (
        <div style={{ textAlign: "center", padding: 60, opacity: 0.6 }}>Cargando subastas...</div>
      ) : live.length === 0 ? (
        <div className="card" style={{ textAlign: "center", padding: 50 }}>
          <Flame size={30} color="var(--ladrillo)" />
          <div style={{ fontFamily: "var(--font-display)", fontWeight: 700, fontSize: 17, marginTop: 8 }}>
            No hay subastas activas ahora
          </div>
          <div style={{ fontSize: 13, opacity: 0.6, marginTop: 4 }}>
            En cuanto MrFull publique un producto, aparecerá aquí. ¡Mantente atento!
          </div>
        </div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          <div style={{ fontFamily: "var(--font-display)", fontWeight: 700, fontSize: 15 }}>
            Subastas activas ({live.length})
          </div>
          {live.map((a) => <AuctionCard key={a.id} auction={a} topAmount={topAmounts[a.id]} />)}
        </div>
      )}

      {upcoming.length > 0 && (
        <div style={{ marginTop: 24 }}>
          <div style={{ fontFamily: "var(--font-display)", fontWeight: 700, fontSize: 15, marginBottom: 10 }}>
            Próximamente ({upcoming.length})
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            {upcoming.map((a) => (
              <div key={a.id} className="card" style={{ display: "flex", gap: 12, alignItems: "center", opacity: 0.8 }}>
                <div style={{ width: 56, height: 56, borderRadius: 12, background: "var(--crema-suave)", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
                  {a.image_url ? <img src={a.image_url} alt={a.title} style={{ width: "100%", height: "100%", objectFit: "cover", borderRadius: 12 }} /> : <Flame size={20} color="var(--ladrillo)" />}
                </div>
                <div style={{ flex: 1 }}>
                  <div style={{ fontWeight: 700, fontSize: 15 }}>{a.title}</div>
                  <div style={{ fontSize: 12, opacity: 0.6 }}>
                    Empieza el {new Date(a.starts_at).toLocaleString("es-CO", { dateStyle: "medium", timeStyle: "short" })}
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {closed.length > 0 && (
        <div style={{ marginTop: 28 }}>
          <div style={{ fontFamily: "var(--font-display)", fontWeight: 700, fontSize: 15, marginBottom: 10, opacity: 0.7 }}>
            Subastas cerradas recientemente
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            {closed.slice(0, 8).map((a) => <AuctionCard key={a.id} auction={a} topAmount={topAmounts[a.id]} />)}
          </div>
        </div>
      )}
    </div>
  );
}
