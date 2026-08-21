// Número de contacto de MrFull para WhatsApp (formato internacional, sin + ni espacios)
export const WHATSAPP_NUMBER = "573005276415";

export function waLink(message) {
  return `https://wa.me/${WHATSAPP_NUMBER}?text=${encodeURIComponent(message)}`;
}

export function waWinnerMessage({ title, amount, fullName }) {
  return (
    `¡Hola MrFull! 🔥 Gané la subasta de *${title}* por $${Number(amount).toLocaleString("es-CO")}.\n` +
    `Mi nombre es ${fullName}. Quiero coordinar cómo reclamar mi premio 🎉`
  );
}

export function waGeneralMessage() {
  return "¡Hola MrFull! Tengo una pregunta sobre las subastas 🙂";
}
