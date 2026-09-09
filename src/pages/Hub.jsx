import { useSiteSettings } from "../lib/siteSettings";
import { SUBASTAS_HOSTNAME, REMATAZOS_HOSTNAME, CONCURSO_HOSTNAME } from "../lib/domain";
import { Gavel, Zap, Brain } from "lucide-react";

const SECTIONS = [
  {
    hostname: SUBASTAS_HOSTNAME,
    icon: Gavel,
    title: "Subastas",
    description: "Puja en vivo por comida callejera. Gana el que más ofrezca.",
  },
  {
    hostname: REMATAZOS_HOSTNAME,
    icon: Zap,
    title: "Rematazos",
    description: "Precio de rematazo, cupos contados. Se acaba cuando llega la hora o se llenan los cupos.",
  },
  {
    hostname: CONCURSO_HOSTNAME,
    icon: Brain,
    title: "Concurso",
    description: "Torneo de cultura general: duelos 1 vs 1 de eliminación directa hasta que quede un solo ganador.",
  },
];

export default function Hub() {
  const { logo_url } = useSiteSettings();

  return (
    <div style={{ maxWidth: 520, margin: "0 auto", padding: "48px 16px 60px", textAlign: "center" }}>
      {logo_url && (
        <img src={logo_url} alt="MrFull" style={{ width: 72, height: 72, objectFit: "contain", margin: "0 auto 12px" }} />
      )}
      <div style={{ fontFamily: "var(--font-display)", fontWeight: 800, fontSize: 26, marginBottom: 6 }}>
        MrFull
      </div>
      <div style={{ fontSize: 13.5, opacity: 0.7, marginBottom: 28 }}>
        Elige a qué quieres entrar
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
        {SECTIONS.map(({ hostname, icon: Icon, title, description }) => (
          <a
            key={hostname}
            href={`https://${hostname}/`}
            className="card"
            style={{
              display: "flex", alignItems: "center", gap: 14, textAlign: "left",
              textDecoration: "none", color: "inherit",
            }}
          >
            <div style={{
              width: 44, height: 44, borderRadius: 12, background: "var(--crema-suave)",
              display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0,
            }}>
              <Icon size={22} color="var(--ladrillo)" />
            </div>
            <div>
              <div style={{ fontFamily: "var(--font-display)", fontWeight: 700, fontSize: 16 }}>{title}</div>
              <div style={{ fontSize: 12.5, opacity: 0.7, marginTop: 2 }}>{description}</div>
            </div>
          </a>
        ))}
      </div>
    </div>
  );
}
