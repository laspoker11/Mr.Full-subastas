import { useState } from "react";
import { Share2 } from "lucide-react";
import { generateStoryImage, shareOrDownloadImage } from "../lib/shareImage";
import { useSiteSettings } from "../lib/siteSettings";

// Botón que genera una imagen (formato Historia de Instagram) con la foto del
// producto, cuándo empezó y cuánto tiempo falta, y la comparte o la descarga.
export default function ShareStoryButton({
  kind, title, imageUrl, startsAt, endsAt, priceLabel, priceValue, badgeLabel, style,
}) {
  const { logo_url } = useSiteSettings();
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");

  async function handleShare() {
    setBusy(true);
    setMsg("");
    try {
      const blob = await generateStoryImage({
        kind, title, imageUrl, logoUrl: logo_url, startsAt, endsAt, priceLabel, priceValue, badgeLabel,
      });
      const filename = `${kind}-${(title || "mrfull").toLowerCase().replace(/[^a-z0-9]+/g, "-").slice(0, 40)}.png`;
      const result = await shareOrDownloadImage(blob, {
        filename,
        title: title || "MrFull",
        text: `¡Mira esto en MrFull! ${title || ""}`,
      });
      if (result === "downloaded") {
        setMsg("Imagen descargada 📥 Ábrela y súbela a tu Historia de Instagram.");
      }
    } catch {
      setMsg("No se pudo generar la imagen. Intenta de nuevo.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div style={style}>
      <button
        type="button"
        onClick={handleShare}
        disabled={busy}
        style={{
          display: "flex", alignItems: "center", justifyContent: "center", gap: 8,
          background: "var(--carbon)", color: "var(--texto-sobre-oscuro)", border: "none",
          borderRadius: 10, padding: "11px 16px", fontWeight: 700, fontSize: 13.5,
          cursor: busy ? "default" : "pointer", opacity: busy ? 0.7 : 1, width: "100%",
        }}
      >
        <Share2 size={16} /> {busy ? "Generando imagen..." : "Compartir en Instagram"}
      </button>
      {msg && <div style={{ fontSize: 12, opacity: 0.7, marginTop: 6, textAlign: "center" }}>{msg}</div>}
    </div>
  );
}
