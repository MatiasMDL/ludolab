import crypto from "node:crypto";

export const env = (k, fallback) => {
  const v = process.env[k];
  if (v === undefined || v === "") {
    if (fallback !== undefined) return fallback;
    throw new Error(`Falta la variable de entorno ${k}`);
  }
  return v;
};

export const PRODUCT_ID = "100-juegos-con-dados";
export const price = () => Number(env("PRICE_ARS", "11999"));

/* ---------- Mercado Pago ---------- */
export async function mp(path, opts = {}) {
  const r = await fetch("https://api.mercadopago.com" + path, {
    ...opts,
    headers: {
      Authorization: `Bearer ${env("MP_ACCESS_TOKEN")}`,
      "Content-Type": "application/json",
      ...(opts.headers || {}),
    },
  });
  const data = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(`Mercado Pago ${r.status}: ${JSON.stringify(data)}`);
  return data;
}

export const getPayment = (id) => mp(`/v1/payments/${encodeURIComponent(id)}`);

// El contacto viaja en external_reference: "ebook|email|nombre@gmail.com" o "ebook|whatsapp|5491123456789"
export function encodeRef(channel, value) {
  return `${PRODUCT_ID}|${channel}|${value}`;
}
export function decodeRef(ref = "") {
  const [product, channel, value] = String(ref).split("|");
  if (product !== PRODUCT_ID || !channel || !value) return null;
  return { channel, value };
}

// Un pago sirve para descargar solo si es de este producto, está aprobado y pagó el precio completo
export function isValidPurchase(p) {
  return p && p.status === "approved" && decodeRef(p.external_reference) && Number(p.transaction_amount) >= price();
}

/* ---------- Links de descarga firmados ---------- */
const b64 = (s) => Buffer.from(s).toString("base64url");
const hmac = (s) => crypto.createHmac("sha256", env("DOWNLOAD_SECRET")).update(s).digest("base64url");

export function downloadUrl(paymentId, days = 7) {
  const payload = b64(`${paymentId}.${Date.now() + days * 864e5}`);
  return `${env("SITE_URL")}/api/download?t=${payload}.${hmac(payload)}`;
}

export function readToken(t = "") {
  const [payload, sig] = String(t).split(".");
  if (!payload || !sig) return null;
  const expected = hmac(payload);
  if (sig.length !== expected.length || !crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) return null;
  const [paymentId, exp] = Buffer.from(payload, "base64url").toString().split(".");
  if (!paymentId || Date.now() > Number(exp)) return null;
  return { paymentId };
}

/* ---------- Entrega ---------- */
async function sendEmail(to, subject, html) {
  const r = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${env("RESEND_API_KEY")}`, "Content-Type": "application/json" },
    body: JSON.stringify({ from: env("EMAIL_FROM"), to: [to], subject, html }),
  });
  if (!r.ok) throw new Error(`Resend ${r.status}: ${await r.text()}`);
}

const buyerEmailHtml = (link) => `
<div style="font-family:Arial,sans-serif;max-width:520px;margin:auto;color:#22254A">
  <h1 style="font-size:26px">¡Gracias por tu compra!</h1>
  <p>Acá tenés tu ebook <b>100 juegos con dados</b>. Descargalo, imprimilo y a jugar.</p>
  <p style="margin:28px 0"><a href="${link}" style="background:#D63B30;color:#fff;padding:14px 24px;border-radius:999px;text-decoration:none;font-weight:bold">Descargar el PDF</a></p>
  <p style="color:#5A5D7E;font-size:14px">El link funciona durante 7 días. Guardá el PDF en tu compu o en el celu para imprimirlo cuando quieras.</p>
  <p style="color:#5A5D7E;font-size:14px">Recordá: es para uso familiar o en el aula. Por favor no lo compartas ni lo revendas.</p>
  <p>Un abrazo,<br>LudoLab</p>
</div>`;

async function sendWhatsApp(to, link) {
  // Requiere una plantilla aprobada en Meta con 1 variable en el cuerpo, por ejemplo:
  // "¡Gracias por comprar 100 juegos con dados! Descargá tu ebook acá: {{1}}"
  const r = await fetch(`https://graph.facebook.com/v21.0/${env("WA_PHONE_NUMBER_ID")}/messages`, {
    method: "POST",
    headers: { Authorization: `Bearer ${env("WA_TOKEN")}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      messaging_product: "whatsapp",
      to,
      type: "template",
      template: {
        name: env("WA_TEMPLATE", "ebook_entrega"),
        language: { code: env("WA_TEMPLATE_LANG", "es_AR") },
        components: [{ type: "body", parameters: [{ type: "text", text: link }] }],
      },
    }),
  });
  if (!r.ok) throw new Error(`WhatsApp ${r.status}: ${await r.text()}`);
}

export async function deliver(payment) {
  const contact = decodeRef(payment.external_reference);
  const link = downloadUrl(payment.id);
  const owner = env("OWNER_EMAIL", "");
  let sentToBuyer = false;

  try {
    if (contact.channel === "email") {
      await sendEmail(contact.value, "Tu ebook: 100 juegos con dados 🎲", buyerEmailHtml(link));
      sentToBuyer = true;
    } else if (process.env.WA_TOKEN && process.env.WA_PHONE_NUMBER_ID) {
      await sendWhatsApp(contact.value, link);
      sentToBuyer = true;
    }
  } catch (e) {
    console.error("Entrega fallida", payment.id, e.message);
  }

  if (owner) {
    const msg = `¡Hola! Gracias por tu compra en LudoLab 🎲 Acá está tu ebook "100 juegos con dados": ${link}`;
    const manual = contact.channel === "whatsapp"
      ? `<p><a href="https://wa.me/${contact.value}?text=${encodeURIComponent(msg)}">Mandárselo por WhatsApp en un toque</a></p>`
      : "";
    await sendEmail(
      owner,
      `${sentToBuyer ? "Nueva venta" : "⚠️ Venta para enviar a mano"}: $${payment.transaction_amount}`,
      `<p>Pago ${payment.id} aprobado por $${payment.transaction_amount}.</p>
       <p>Contacto: <b>${contact.channel === "whatsapp" ? "+" : ""}${contact.value}</b> (${contact.channel})</p>
       <p>${sentToBuyer ? "El ebook ya se envió automáticamente." : "No se pudo enviar automáticamente: mandalo vos."}</p>
       ${manual}<p>Link de descarga: ${link}</p>`
    ).catch((e) => console.error("Aviso a la dueña fallido", e.message));
  }
  return { sentToBuyer };
}
