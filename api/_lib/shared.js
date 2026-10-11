import crypto from "node:crypto";
import { put, head, del } from "@vercel/blob";

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
      Authorization: `Bearer ${env("MP_ACCESS_TOKEN").trim().replace(/^Bearer\s+/i, "")}`,
      "Content-Type": "application/json",
      ...(opts.headers || {}),
    },
  });
  const data = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(`Mercado Pago ${r.status}: ${JSON.stringify(data)}`);
  return data;
}

export const getPayment = (id) => mp(`/v1/payments/${encodeURIComponent(id)}`);

// El contacto y la versión de la landing viajan en external_reference:
// "100-juegos-con-dados|email|nombre@gmail.com|A" o "100-juegos-con-dados|whatsapp|5491123456789|B"
export function encodeRef(channel, value, variante) {
  return `${PRODUCT_ID}|${channel}|${value}|${variante === "B" ? "B" : "A"}`;
}
export function decodeRef(ref = "") {
  const [product, channel, value, variante] = String(ref).split("|");
  if (product !== PRODUCT_ID || !channel || !value) return null;
  return { channel, value, variante: variante === "B" || variante === "A" ? variante : null };
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

/* ---------- Una sola vez por pago (marcas en Vercel Blob) ---------- */
// Guarda una marca por pago con un nombre imposible de adivinar. Devuelve true solo la primera vez.
const markPath = (kind, paymentId) => `meta/${kind}-${hmac(`${kind}:${paymentId}`).slice(0, 32)}.txt`;

export async function claimOnce(kind, paymentId) {
  if (!process.env.BLOB_READ_WRITE_TOKEN) {
    console.warn("Falta BLOB_READ_WRITE_TOKEN: no se pueden evitar envíos duplicados");
    return true;
  }
  const path = markPath(kind, paymentId);
  try {
    await put(path, new Date().toISOString(), { access: "public", addRandomSuffix: false, allowOverwrite: false, contentType: "text/plain" });
    return true;
  } catch (e) {
    try { await head(path); return false; } // ya existía: ya se hizo
    catch { console.error("claimOnce", kind, paymentId, e.message); return true; }
  }
}

async function releaseClaim(kind, paymentId) {
  if (process.env.BLOB_READ_WRITE_TOKEN) await del(markPath(kind, paymentId)).catch(() => {});
}

/* ---------- API de conversiones de Meta ---------- */
export const PIXEL_ID = "4240054562902602";
const sha = (s) => crypto.createHash("sha256").update(String(s).trim().toLowerCase()).digest("hex");
const clean = (o) => Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined && v !== null && v !== "" && !(Array.isArray(v) && !v.length)));

export const clientIp = (req) => String(req.headers["x-forwarded-for"] || req.headers["x-real-ip"] || "").split(",")[0].trim();

// Manda el Purchase al servidor de Meta una sola vez por pago, con event_id mp_<payment_id>
// (el mismo que usa el navegador, así Meta los cuenta como una sola compra).
export async function sendPurchaseOnce(payment, req) {
  const token = process.env.META_CAPI_TOKEN;
  if (!token) return { skipped: "falta META_CAPI_TOKEN" };
  if (!isValidPurchase(payment)) return { skipped: "pago no aprobado" };
  if (!(await claimOnce("capi", payment.id))) return { skipped: "ya enviado" };

  const c = decodeRef(payment.external_reference);
  const m = payment.metadata || {};
  const emails = [...new Set([c.channel === "email" ? c.value : null, payment.payer?.email]
    .filter((e) => e && /^[^\s@]+@[^\s@]+\.[a-z]{2,}$/i.test(e)).map((e) => e.trim().toLowerCase()))];
  const phone = c.channel === "whatsapp" ? c.value.replace(/\D/g, "") : null;
  const variante = c.variante || (String(m.landing || "").toLowerCase() === "b" ? "B" : "A");
  const approved = Date.parse(payment.date_approved || "") || Date.now();

  const event = {
    event_name: "Purchase",
    event_time: Math.floor(Math.min(approved, Date.now()) / 1000),
    event_id: `mp_${payment.id}`,
    action_source: "website",
    event_source_url: `${env("SITE_URL")}/gracias`,
    user_data: clean({
      em: emails.map(sha),
      ph: phone ? [sha(phone)] : [],
      external_id: [sha(c.value)],
      country: [sha("ar")],
      fbp: m.fbp,
      fbc: m.fbc,
      client_ip_address: m.client_ip || (req && clientIp(req)),
      client_user_agent: m.client_ua || (req && req.headers["user-agent"]),
    }),
    custom_data: {
      value: Number(payment.transaction_amount),
      currency: "ARS",
      content_name: "100 juegos con dados",
      content_ids: [PRODUCT_ID],
      content_type: "product",
      num_items: 1,
      variante,
    },
  };

  const body = { data: [event], access_token: token };
  if (process.env.META_TEST_EVENT_CODE) body.test_event_code = process.env.META_TEST_EVENT_CODE;
  try {
    const r = await fetch(`https://graph.facebook.com/v21.0/${PIXEL_ID}/events`, {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
    });
    const out = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(`Meta ${r.status}: ${JSON.stringify(out).slice(0, 300)}`);
    console.log("Purchase enviado a Meta", payment.id, variante, out.events_received);
    return { sent: true };
  } catch (e) {
    await releaseClaim("capi", payment.id); // así el próximo aviso lo reintenta
    throw e;
  }
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
