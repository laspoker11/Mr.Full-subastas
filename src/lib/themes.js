// Cada tema es un conjunto de variables CSS que reemplazan las de styles.css
// en tiempo real. Las tipografías (Baloo 2 / Inter / JetBrains Mono) se
// mantienen iguales en los tres para no perder legibilidad, pero la paleta
// de color y el tono general cambian por completo.

export const THEMES = {
  fuego: {
    label: "Fuego Callejero",
    description: "Cálido y directo — ladrillo, queso derretido y carbón. El estilo original.",
    preview: ["#C1442D", "#F2B134", "#201A15"],
    vars: {
      "--ladrillo": "#C1442D",
      "--ladrillo-oscuro": "#9C3521",
      "--queso": "#F2B134",
      "--queso-claro": "#FBD98A",
      "--carbon": "#201A15",
      "--carbon-suave": "#2C241D",
      "--crema": "#FBF3E6",
      "--crema-suave": "#F3E7D2",
      "--salsa": "#6B8E4E",
      "--alerta": "#A8322D",
      "--texto-sobre-oscuro": "#FBF3E6",
    },
  },
  neon: {
    label: "Noche Neón",
    description: "Oscuro y vibrante — ideal para subastas nocturnas o de fin de semana.",
    preview: ["#FF2E63", "#00F5D4", "#0D0221"],
    vars: {
      "--ladrillo": "#FF2E63",
      "--ladrillo-oscuro": "#C41E4C",
      "--queso": "#00F5D4",
      "--queso-claro": "#7FFFEF",
      "--carbon": "#0D0221",
      "--carbon-suave": "#1E1033",
      "--crema": "#170B2E",
      "--crema-suave": "#2A1B4D",
      "--salsa": "#00E676",
      "--alerta": "#FF1744",
      "--texto-sobre-oscuro": "#F3E7D2",
    },
  },
  tropical: {
    label: "Tropical Fresco",
    description: "Fresco y luminoso — mango, limón y mar. Se siente a fin de semana.",
    preview: ["#FF6B35", "#FFD23F", "#073B3A"],
    vars: {
      "--ladrillo": "#FF6B35",
      "--ladrillo-oscuro": "#E0501C",
      "--queso": "#FFD23F",
      "--queso-claro": "#FFE896",
      "--carbon": "#073B3A",
      "--carbon-suave": "#0F4F4D",
      "--crema": "#EAF7F0",
      "--crema-suave": "#D3EDE0",
      "--salsa": "#06A77D",
      "--alerta": "#E63946",
      "--texto-sobre-oscuro": "#EAF7F0",
    },
  },
};

export function applyTheme(themeKey) {
  const theme = THEMES[themeKey] || THEMES.fuego;
  const root = document.documentElement;
  Object.entries(theme.vars).forEach(([key, value]) => {
    root.style.setProperty(key, value);
  });
  // El texto sobre fondo "crema" cambia de oscuro a claro en el tema oscuro (Neón)
  root.style.setProperty("--texto-principal", themeKey === "neon" ? "#F3E7D2" : "#201A15");
}
