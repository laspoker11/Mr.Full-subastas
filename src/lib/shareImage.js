// Genera una imagen tipo Historia de Instagram (1080x1920) para compartir una
// subasta o un rematazo, con foto del producto, cuándo empezó y cuánto falta.

const W = 1080;
const H = 1920;

function loadImage(url) {
  return new Promise((resolve) => {
    if (!url) return resolve(null);
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => resolve(img);
    img.onerror = () => resolve(null);
    img.src = url;
  });
}

function cssVar(name, fallback) {
  const v = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  return v || fallback;
}

function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

function wrapText(ctx, text, maxWidth, maxLines) {
  const words = (text || "").split(" ");
  const lines = [];
  let line = "";
  for (const word of words) {
    const test = line ? line + " " + word : word;
    if (ctx.measureText(test).width > maxWidth && line) {
      lines.push(line);
      line = word;
    } else {
      line = test;
    }
  }
  if (line) lines.push(line);
  if (maxLines && lines.length > maxLines) {
    const trimmed = lines.slice(0, maxLines);
    trimmed[maxLines - 1] = trimmed[maxLines - 1].replace(/\s*$/, "") + "…";
    return trimmed;
  }
  return lines;
}

function fmtMoneyLocal(n) {
  if (n === null || n === undefined || isNaN(n)) return "";
  return "$" + Number(n).toLocaleString("es-CO");
}

function fmtDateTime(iso) {
  return new Date(iso).toLocaleString("es-CO", { dateStyle: "medium", timeStyle: "short" });
}

function timeLeftLabel(endsAt) {
  const diff = new Date(endsAt).getTime() - Date.now();
  if (diff <= 0) return null;
  const s = Math.floor(diff / 1000);
  const days = Math.floor(s / 86400);
  const hours = Math.floor((s % 86400) / 3600);
  const mins = Math.floor((s % 3600) / 60);
  const parts = [];
  if (days) parts.push(`${days}d`);
  if (days || hours) parts.push(`${hours}h`);
  parts.push(`${mins}m`);
  return parts.join(" ");
}

export async function generateStoryImage({
  kind, // "subasta" | "rematazo"
  title,
  imageUrl,
  logoUrl,
  startsAt,
  endsAt,
  priceLabel,
  priceValue,
  badgeLabel,
}) {
  if (document.fonts && document.fonts.ready) {
    try { await document.fonts.ready; } catch { /* seguimos con las fuentes que haya */ }
  }

  const canvas = document.createElement("canvas");
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext("2d");

  const ladrillo = cssVar("--ladrillo", "#C1442D");
  const queso = cssVar("--queso", "#F2B134");
  const carbon = cssVar("--carbon", "#201A15");
  const carbonSuave = cssVar("--carbon-suave", "#2C241D");
  const crema = cssVar("--crema", "#FBF3E6");

  const grad = ctx.createLinearGradient(0, 0, 0, H);
  grad.addColorStop(0, carbonSuave);
  grad.addColorStop(1, carbon);
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, W, H);

  ctx.fillStyle = ladrillo;
  ctx.fillRect(0, 0, W, 14);

  // textBaseline "top" hace que cada fillText se posicione por su borde
  // superior — así cada bloque se apila sumando alturas conocidas, sin
  // adivinar por la línea base y sin riesgo de que se encimen entre sí.
  ctx.textAlign = "center";
  ctx.textBaseline = "top";
  let y = 90;

  const logoImg = await loadImage(logoUrl);
  if (logoImg) {
    const size = 96;
    ctx.save();
    ctx.beginPath();
    ctx.arc(W / 2, y + size / 2, size / 2, 0, Math.PI * 2);
    ctx.closePath();
    ctx.clip();
    ctx.drawImage(logoImg, W / 2 - size / 2, y, size, size);
    ctx.restore();
    y += size + 34;
  }

  ctx.fillStyle = crema;
  ctx.font = "800 42px 'Baloo 2'";
  ctx.fillText(kind === "rematazo" ? "REMATAZOS MRFULL" : "SUBASTAS MRFULL", W / 2, y);
  y += 42 * 1.3 + 26;

  ctx.font = "700 30px 'Inter'";
  const badge = badgeLabel || (kind === "rematazo" ? "⚡ REMATAZO" : "🔥 EN VIVO");
  const badgeH = 64;
  const badgeWidth = ctx.measureText(badge).width + 64;
  roundRect(ctx, W / 2 - badgeWidth / 2, y, badgeWidth, badgeH, badgeH / 2);
  ctx.fillStyle = ladrillo;
  ctx.fill();
  ctx.fillStyle = "#fff";
  ctx.textBaseline = "middle";
  ctx.fillText(badge, W / 2, y + badgeH / 2);
  ctx.textBaseline = "top";
  y += badgeH + 46;

  const photoX = 90, photoY = y, photoW = W - 180, photoH = 720;
  roundRect(ctx, photoX, photoY, photoW, photoH, 32);
  ctx.save();
  ctx.clip();
  ctx.fillStyle = carbonSuave;
  ctx.fillRect(photoX, photoY, photoW, photoH);
  const productImg = await loadImage(imageUrl);
  if (productImg) {
    const scale = Math.max(photoW / productImg.width, photoH / productImg.height);
    const dw = productImg.width * scale, dh = productImg.height * scale;
    ctx.drawImage(productImg, photoX + (photoW - dw) / 2, photoY + (photoH - dh) / 2, dw, dh);
  } else {
    ctx.fillStyle = queso;
    ctx.font = "90px sans-serif";
    ctx.textBaseline = "middle";
    ctx.fillText(kind === "rematazo" ? "⚡" : "🔥", photoX + photoW / 2, photoY + photoH / 2);
    ctx.textBaseline = "top";
  }
  ctx.restore();
  ctx.strokeStyle = ladrillo;
  ctx.lineWidth = 6;
  roundRect(ctx, photoX, photoY, photoW, photoH, 32);
  ctx.stroke();

  y = photoY + photoH + 60;

  ctx.fillStyle = crema;
  ctx.font = "800 54px 'Baloo 2'";
  const titleLineHeight = 54 * 1.25;
  const titleLines = wrapText(ctx, title || "", W - 160, 2);
  titleLines.forEach((line, i) => ctx.fillText(line, W / 2, y + i * titleLineHeight));
  y += titleLines.length * titleLineHeight + 34;

  if (priceValue != null) {
    ctx.font = "600 28px 'Inter'";
    ctx.fillStyle = queso;
    ctx.fillText(priceLabel || "Precio", W / 2, y);
    y += 28 * 1.3 + 10;
    ctx.font = "700 72px 'JetBrains Mono'";
    ctx.fillStyle = "#fff";
    ctx.fillText(fmtMoneyLocal(priceValue), W / 2, y);
    y += 72 * 1.25 + 34;
  }

  const infoLines = [];
  if (startsAt) infoLines.push(`🕒 Empezó: ${fmtDateTime(startsAt)}`);
  if (endsAt) {
    const left = timeLeftLabel(endsAt);
    infoLines.push(left ? `⏳ Faltan: ${left}` : "⏱️ Tiempo agotado");
  }

  if (infoLines.length) {
    const lineH = 46;
    const padY = 28;
    const cardH = lineH * infoLines.length + padY * 2;
    const cardY = y;
    roundRect(ctx, 90, cardY, W - 180, cardH, 26);
    ctx.fillStyle = "rgba(255,255,255,0.08)";
    ctx.fill();
    ctx.strokeStyle = queso;
    ctx.lineWidth = 3;
    roundRect(ctx, 90, cardY, W - 180, cardH, 26);
    ctx.stroke();

    ctx.font = "700 34px 'Inter'";
    ctx.fillStyle = crema;
    infoLines.forEach((line, i) => ctx.fillText(line, W / 2, cardY + padY + i * lineH + (lineH - 34) / 2));
  }

  ctx.font = "600 28px 'Inter'";
  ctx.fillStyle = queso;
  ctx.fillText(kind === "rematazo" ? "👉 Inscríbete en" : "👉 Puja ahora en", W / 2, H - 150);
  ctx.font = "700 34px 'JetBrains Mono'";
  ctx.fillStyle = crema;
  ctx.fillText(window.location.host, W / 2, H - 96);

  return new Promise((resolve) => canvas.toBlob(resolve, "image/png", 0.95));
}

// Intenta abrir el menú nativo de compartir del teléfono (donde se puede elegir
// Instagram y subir a Historias); si el navegador no lo soporta, descarga la
// imagen para que el usuario la suba manualmente.
export async function shareOrDownloadImage(blob, { filename, title, text, url }) {
  const file = new File([blob], filename, { type: "image/png" });
  if (navigator.canShare && navigator.canShare({ files: [file] })) {
    try {
      await navigator.share({ files: [file], title, text, url });
      return "shared";
    } catch (e) {
      if (e && e.name === "AbortError") return "cancelled";
    }
  }
  const objectUrl = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = objectUrl;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  setTimeout(() => URL.revokeObjectURL(objectUrl), 10000);
  return "downloaded";
}
