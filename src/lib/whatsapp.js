// Número de contacto de MrFull para WhatsApp (formato internacional, sin + ni espacios)
export const WHATSAPP_NUMBER = "573005276415";

export function waLink(message) {
  return `https://wa.me/${WHATSAPP_NUMBER}?text=${encodeURIComponent(message)}`;
}

export function waWinnerMessage({ title, amount, commissionPercent, total, fullName }) {
  const comisionLine = commissionPercent
    ? ` (puja $${Number(amount).toLocaleString("es-CO")} + costo de administración ${commissionPercent}% = $${Number(total).toLocaleString("es-CO")})`
    : "";
  return (
    `¡Hola MrFull! 🔥 Gané la subasta de *${title}*.\n` +
    `Total a pagar: $${Number(total ?? amount).toLocaleString("es-CO")}${comisionLine}.\n` +
    `Mi nombre es ${fullName}. Quiero coordinar cómo reclamar mi premio 🎉`
  );
}

export function waGeneralMessage() {
  return "¡Hola MrFull! Tengo una pregunta sobre las subastas 🙂";
}
