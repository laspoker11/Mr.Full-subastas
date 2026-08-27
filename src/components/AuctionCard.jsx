import { Link } from "react-router-dom";
import Countdown, { timeParts } from "./Countdown";
import { useAuth } from "../lib/auth";
import { logActivity } from "../lib/activity";

export function fmtMoney(n) {
  if (n === null || n === undefined || isNaN(n)) return "-";
  return "$" + Number(n).toLocaleString("es-CO");
}

// Botones de puja rápida: el salto depende del tamaño de la subasta
// (no tiene sentido subir de $1.000 en $1.000 en una subasta de $200.000)
export function quickIncrements(startPrice) {
  if (startPrice <= 10000) return [1000, 2000];
  if (startPrice <= 25000) return [2000, 3000];
  if (startPrice <= 50000) return [3000, 5000];
  if (startPrice <= 100000) return [5000, 10000];
  return [10000, 20000];
}

// Total a pagar al ganar: la puja más el costo de administración de la subasta
export function totalWithCommission(amount, commissionPercent) {
  return Math.round(amount * (1 + (commissionPercent || 0) / 100));
}

export default function AuctionCard({ auction, topAmount }) {
  const { expired } = timeParts(auction.ends_at);
  const live = auction.status === "live" && !expired;
  const { user } = useAuth();

  return (
    <Link
      to={`/subasta/${auction.id}`}
      style={{ textDecoration: "none", color: "inherit" }}
      onClick={() => logActivity(user?.id, "click", location.pathname, `ver_subasta:${auction.title}`)}
    >
      <div className="card" style={{ display: "flex", gap: 12, alignItems: "center" }}>
        <div style={{
          width: 64, height: 64, borderRadius: 12, overflow: "hidden", flexShrink: 0,
          background: "var(--crema-suave)", display: "flex", alignItems: "center", justifyContent: "center",
        }}>
          {auction.image_url
            ? <img src={auction.image_url} alt={auction.title} style={{ width: "100%", height: "100%", objectFit: "contain" }} />
            : <span style={{ fontSize: 24 }}>🔥</span>}
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontFamily: "var(--font-display)", fontWeight: 700, fontSize: 16 }}>{auction.title}</div>
          <div style={{ fontSize: 11, opacity: 0.45, fontFamily: "var(--font-mono)" }}>ID: {auction.display_id}</div>
          <div style={{ fontSize: 12.5, opacity: 0.6 }}>
            {auction.status === "confirming" ? "Esperando confirmación del ganador"
              : live ? <>Cierra en <Countdown endsAt={auction.ends_at} /></>
              : "Cerrada"}
          </div>
        </div>
        <div style={{ textAlign: "right" }}>
          <div style={{ fontFamily: "var(--font-mono)", fontWeight: 700, fontSize: 15, color: "var(--ladrillo)" }}>
            {fmtMoney(topAmount ?? auction.start_price)}
          </div>
          <span className="pill" style={{
            background: live ? "var(--salsa)" : auction.status === "confirming" ? "var(--queso)" : "#ddd",
            color: live ? "white" : "var(--carbon)",
          }}>
            {live ? "En vivo" : auction.status === "confirming" ? "Confirmando" : "Cerrada"}
          </span>
        </div>
      </div>
    </Link>
  );
}
