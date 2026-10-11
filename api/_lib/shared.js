import crypto from "node:crypto";
import { put, head, del, list } from "@vercel/blob";

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
// Manda un mail con Resend. Reintenta 2 veces si falla. Devuelve el id del envío o tira el último error.
async function sendEmail(to, subject, html, { bcc, text } = {}) {
  let last;
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const r = await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: { Authorization: `Bearer ${env("RESEND_API_KEY")}`, "Content-Type": "application/json" },
        body: JSON.stringify(clean({
          from: env("EMAIL_FROM"), to: [to], bcc: bcc ? [bcc] : undefined,
          reply_to: process.env.REPLY_TO || undefined, subject, html, text,
        })),
      });
      const out = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(`Resend ${r.status}: ${out.message || JSON.stringify(out)}`);
      return out.id;
    } catch (e) {
      last = e;
      if (attempt < 3) await new Promise((ok) => setTimeout(ok, 1500 * attempt));
    }
  }
  throw last;
}

export const BUYER_SUBJECT = "Tu ebook 100 juegos con dados – link de descarga";

const buyerEmailHtml = (link) => `
<div style="font-family:Arial,sans-serif;max-width:520px;margin:auto;color:#22254A">
  <h1 style="font-size:24px">¡Gracias por tu compra!</h1>
  <p>Acá tenés tu ebook <b>100 juegos con dados</b>. Descargalo, imprimilo y a jugar.</p>
  <p style="margin:28px 0"><a href="${link}" style="background:#D63B30;color:#fff;padding:14px 24px;border-radius:999px;text-decoration:none;font-weight:bold">Descargar el PDF</a></p>
  <p style="color:#5A5D7E;font-size:14px">Si el botón no anda, copiá este link en el navegador:<br>${link}</p>
  <p style="color:#5A5D7E;font-size:14px">El link funciona durante 7 días. Guardá el PDF en tu compu o en el celu para imprimirlo cuando quieras.</p>
  <p style="color:#5A5D7E;font-size:14px">Es para uso familiar o en el aula. Por favor no lo compartas ni lo revendas.</p>
  <p>Un abrazo,<br>LudoLab</p>
</div>`;

const buyerEmailText = (link) =>
  `¡Gracias por tu compra!\n\nAcá tenés tu ebook "100 juegos con dados". Descargalo desde este link:\n${link}\n\nEl link funciona durante 7 días.\n\nUn abrazo,\nLudoLab`;

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
  const out = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(`WhatsApp ${r.status}: ${JSON.stringify(out).slice(0, 300)}`);
  return out.messages?.[0]?.id || "ok";
}

const horaAR = (d) => new Date(d || Date.now()).toLocaleString("es-AR", { timeZone: "America/Argentina/Buenos_Aires", dateStyle: "short", timeStyle: "short" });
const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);

// Registro de envíos: un archivo JSON por venta en Vercel Blob (carpeta envios/, nombre imposible de adivinar).
async function logDelivery(entry) {
  console.log("Envío", JSON.stringify(entry));
  if (!process.env.BLOB_READ_WRITE_TOKEN) return;
  const path = `envios/${entry.fecha.slice(0, 10)}-${entry.payment_id}-${hmac(`envio:${entry.payment_id}`).slice(0, 16)}.json`;
  await put(path, JSON.stringify(entry, null, 2), { access: "public", addRandomSuffix: false, allowOverwrite: true, contentType: "application/json" })
    .catch((e) => console.error("No se pudo guardar el registro", e.message));
}

export async function listDeliveries(limit = 100) {
  const { blobs } = await list({ prefix: "envios/", limit: 1000 });
  const latest = blobs.sort((a, b) => b.pathname.localeCompare(a.pathname)).slice(0, limit);
  return Promise.all(latest.map((b) => fetch(b.url, { cache: "no-store" }).then((r) => r.json()).catch(() => ({ archivo: b.pathname }))));
}

// Entrega el ebook una sola vez por pago, manda copia oculta y aviso a la dueña, y deja registro.
export async function deliver(payment) {
  if (!(await claimOnce("mail", payment.id))) return { skipped: "ya entregado" };

  const contact = decodeRef(payment.external_reference);
  const link = downloadUrl(payment.id);
  const owner = env("OWNER_EMAIL", "");
  const variante = contact.variante || (String(payment.metadata?.landing || "").toLowerCase() === "b" ? "B" : "A");
  const entry = {
    payment_id: String(payment.id),
    fecha: new Date().toISOString(),
    hora_ar: horaAR(payment.date_approved),
    canal: contact.channel,
    mail: contact.channel === "email" ? contact.value : null,
    whatsapp: contact.channel === "whatsapp" ? "+" + contact.value : null,
    mail_mercadopago: payment.payer?.email || null,
    landing: variante,
    monto: payment.transaction_amount,
    estado: "",
    respuesta: null,
    error: null,
  };

  try {
    if (contact.channel === "email") {
      entry.respuesta = await sendEmail(contact.value, BUYER_SUBJECT, buyerEmailHtml(link), { bcc: owner || undefined, text: buyerEmailText(link) });
      entry.estado = "ENVIADO";
    } else if (process.env.WA_TOKEN && process.env.WA_PHONE_NUMBER_ID) {
      entry.respuesta = await sendWhatsApp(contact.value, link);
      entry.estado = "ENVIADO";
    } else {
      entry.estado = "PARA MANDAR POR WHATSAPP";
    }
  } catch (e) {
    entry.estado = "FALLÓ";
    entry.error = String(e.message || e).slice(0, 500);
    console.error("Entrega fallida", payment.id, entry.error);
  }

  await logDelivery(entry);

  if (owner) {
    const what = contact.channel === "email" ? "mail" : "WhatsApp";
    const subject = entry.estado === "PARA MANDAR POR WHATSAPP"
      ? `Venta #${payment.id} – mandalo por WhatsApp`
      : `Venta #${payment.id} – ${what} ${entry.estado}`;
    const msg = `¡Hola! Gracias por tu compra en LudoLab 🎲 Acá está tu ebook "100 juegos con dados": ${link}`;
    const waBtn = contact.channel === "whatsapp"
      ? `<p><a href="https://wa.me/${contact.value}?text=${encodeURIComponent(msg)}">Mandárselo por WhatsApp en un toque</a></p>` : "";
    const row = (k, v) => `<tr><td style="padding:4px 12px 4px 0;color:#5A5D7E">${k}</td><td><b>${esc(v || "—")}</b></td></tr>`;
    await sendEmail(owner, subject, `
      <div style="font-family:Arial,sans-serif;color:#22254A">
      <table>
        ${row("Pago", payment.id)}${row("Monto", "$" + payment.transaction_amount)}${row("Hora", entry.hora_ar)}
        ${row("Mail del comprador", entry.mail)}${row("WhatsApp", entry.whatsapp)}${row("Mail de su Mercado Pago", entry.mail_mercadopago)}
        ${row("Landing", entry.landing)}${row("Envío", entry.estado)}
        ${row("Respuesta del proveedor", entry.error || entry.respuesta)}
      </table>
      ${entry.estado === "FALLÓ" ? "<p><b>El mail no salió: mandale este link vos.</b></p>" : ""}
      ${waBtn}<p>Link de descarga (vence en 7 días): ${link}</p></div>`
    ).catch((e) => console.error("Aviso a la dueña fallido", e.message));
  }
  return { estado: entry.estado };
}
