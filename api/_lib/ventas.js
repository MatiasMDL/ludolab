import { env, SITE, sha, clean, esc, horaAR, randomToken, normEmail, validEmail, clientIp } from "./util.js";
import { redis, pipeline, hgetall, hset, once } from "./db.js";
import { producto } from "./catalogo.js";
import { sendEmail, entregaMail } from "./mail.js";

export const PIXEL_ID = "4240054562902602";
const LEGACY_PRODUCT = "100-juegos-con-dados"; // external_reference de los pagos hechos antes de ludolab.app

/* ---------- external_reference ---------- */
// Nuevo: "<slug>|<orden>"  ·  Viejo: "100-juegos-con-dados|email|nombre@gmail.com|A"
export const encodeRef = (slug, orderId) => `${slug}|${orderId}`;

export function parseRef(ref = "") {
  const parts = String(ref).split("|");
  if (parts[0] === LEGACY_PRODUCT && parts.length >= 3) {
    const [, channel, value, v] = parts;
    return { slug: "dados", legacy: { channel, value, variante: v === "B" ? "B" : v === "A" ? "A" : null } };
  }
  if (parts.length === 2 && producto(parts[0]) && /^[A-Za-z0-9_-]{16,64}$/.test(parts[1])) return { slug: parts[0], orderId: parts[1] };
  return null;
}

/* ---------- Pago válido ---------- */
export function isPaid(payment, info) {
  const prod = info && producto(info.slug);
  return Boolean(prod && payment && payment.status === "approved" && payment.currency_id === "ARS"
    && Number(payment.transaction_amount) >= Number(prod.precio));
}

// Datos que guardamos ANTES de ir a pagar (mail, variante, cookies del píxel...)
export async function loadOrder(info, payment) {
  if (info?.orderId) {
    const o = await hgetall(`order:${info.orderId}`);
    if (o) return o;
  }
  const m = payment?.metadata || {};
  const lg = info?.legacy || {};
  return clean({
    email: lg.channel === "email" ? lg.value : m.email,
    whatsapp: lg.channel === "whatsapp" ? lg.value : undefined,
    variante: lg.variante || (String(m.landing || "").toLowerCase() === "b" ? "B" : "A"),
    cta: m.cta_variant, fbp: m.fbp, fbc: m.fbc, ip: m.client_ip, ua: m.client_ua,
  });
}

/* ---------- Comprador y su link permanente ---------- */
export async function ensureBuyer(email) {
  const key = `buyer:${email}`;
  let token = await redis("HGET", key, "token");
  if (!token) {
    await redis("HSETNX", key, "token", randomToken(24));
    token = await redis("HGET", key, "token");
    await pipeline([["SET", `token:${token}`, email], ["HSETNX", key, "creado", new Date().toISOString()], ["HSETNX", key, "aperturas", 0]]);
  }
  return token;
}

export const ebookLink = (token) => `${SITE()}/mi-ebook/${token}`;

// Guarda la compra una sola vez y la asocia al mail del comprador. Devuelve la compra guardada.
export async function recordPurchase(payment, info, order) {
  const pid = String(payment.id);
  const existing = await hgetall(`purchase:${pid}`);
  if (existing?.token) return existing;

  const payerEmail = normEmail(payment.payer?.email);
  let email = normEmail(order.email);
  if (!validEmail(email)) email = validEmail(payerEmail) ? payerEmail : "";
  if (!email) throw new Error(`Pago ${pid} aprobado sin mail para entregar`);

  const token = await ensureBuyer(email);
  const fecha = payment.date_approved || new Date().toISOString();
  const purchase = clean({
    payment_id: pid, slug: info.slug, order_id: info.orderId, email, payer_email: payerEmail,
    whatsapp: order.whatsapp, variante: order.variante || "A", cta: order.cta,
    monto: payment.transaction_amount, fecha, token, mail_estado: "PENDIENTE", mail_envios: 0,
  });
  const ts = Date.parse(fecha) || Date.now();
  await hset(`purchase:${pid}`, purchase);
  await pipeline([
    ["SADD", `buyer:${email}:compras`, pid],
    ["ZADD", "ventas", ts, pid],
    ["ZADD", `ventas:${info.slug}`, ts, pid],
    ...(validEmail(payerEmail) && payerEmail !== email ? [["SET", `payer:${payerEmail}`, email]] : []),
  ]);
  return { ...purchase, mail_envios: "0" };
}

/* ---------- Mail de entrega ---------- */
// Manda (o reenvía) el link del comprador. Copia oculta a la dueña siempre. Registra el resultado en la compra.
export async function sendDelivery(purchase, { notifyOwner = false } = {}) {
  const prod = producto(purchase.slug);
  const link = ebookLink(purchase.token);
  const owner = process.env.OWNER_EMAIL || "";
  const { subject, html, text } = entregaMail(prod, link);
  const result = { mail_fecha: new Date().toISOString() };
  try {
    result.mail_id = await sendEmail({ to: purchase.email, subject, html, text, bcc: owner || undefined });
    result.mail_estado = "ENVIADO";
    result.mail_error = "";
  } catch (e) {
    result.mail_estado = "FALLÓ";
    result.mail_error = String(e.message || e).slice(0, 400);
    console.error("Entrega fallida", purchase.payment_id, result.mail_error);
  }
  await hset(`purchase:${purchase.payment_id}`, result);
  await redis("HINCRBY", `purchase:${purchase.payment_id}`, "mail_envios", 1);
  console.log("Entrega", purchase.payment_id, purchase.slug, result.mail_estado, result.mail_id || result.mail_error);

  if (notifyOwner && owner) {
    const row = (k, v) => `<tr><td style="padding:4px 12px 4px 0;color:#56565E">${k}</td><td><b>${esc(v || "—")}</b></td></tr>`;
    await sendEmail({
      to: owner,
      subject: `Venta #${purchase.payment_id} – ${prod?.titulo || purchase.slug} – mail ${result.mail_estado}`,
      html: `<div style="font-family:Arial,sans-serif;color:#18181B"><table>
        ${row("Pago", purchase.payment_id)}${row("Ebook", prod?.titulo || purchase.slug)}${row("Monto", "$" + purchase.monto)}
        ${row("Hora", horaAR(purchase.fecha))}${row("Mail del comprador", purchase.email)}${row("Mail de su Mercado Pago", purchase.payer_email)}
        ${row("Landing", purchase.variante)}${row("Envío", result.mail_estado)}${row("Respuesta del proveedor", result.mail_error || result.mail_id)}
      </table>
      ${result.mail_estado === "FALLÓ" ? "<p><b>El mail no salió.</b> Podés reenviarlo desde el panel.</p>" : ""}
      <p>Su link: ${link}</p><p><a href="${SITE()}/admin">Abrir el panel de ventas</a></p></div>`,
    }).catch((e) => console.error("Aviso a la dueña fallido", e.message));
  }
  return result;
}

/* ---------- API de conversiones de Meta ---------- */
export async function sendPurchaseCAPI(payment, purchase, order) {
  const token = process.env.META_CAPI_TOKEN;
  if (!token) return { skipped: "falta META_CAPI_TOKEN" };
  if (!(await once(`capi:${payment.id}`))) return { skipped: "ya enviado" };

  const prod = producto(purchase.slug);
  const emails = [...new Set([purchase.email, purchase.payer_email].filter(Boolean))];
  const approved = Date.parse(payment.date_approved || "") || Date.now();
  const event = {
    event_name: "Purchase",
    event_time: Math.floor(Math.min(approved, Date.now()) / 1000),
    event_id: `mp_${payment.id}`,
    action_source: "website",
    event_source_url: `${SITE()}/${purchase.slug}`,
    user_data: clean({
      em: emails.map(sha),
      ph: order.whatsapp ? [sha(String(order.whatsapp).replace(/\D/g, ""))] : [],
      external_id: [sha(purchase.email)],
      country: [sha("ar")],
      fbp: order.fbp, fbc: order.fbc,
      client_ip_address: order.ip, client_user_agent: order.ua,
    }),
    custom_data: {
      value: Number(payment.transaction_amount), currency: "ARS",
      content_ids: [purchase.slug], content_name: prod?.titulo || purchase.slug,
      content_type: "product", num_items: 1, variante: purchase.variante || "A",
    },
  };
  const req = { data: [event], access_token: token };
  if (process.env.META_TEST_EVENT_CODE) req.test_event_code = process.env.META_TEST_EVENT_CODE;
  try {
    const r = await fetch(`https://graph.facebook.com/v21.0/${PIXEL_ID}/events`, {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(req),
    });
    const out = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(`Meta ${r.status}: ${JSON.stringify(out).slice(0, 300)}`);
    console.log("Purchase enviado a Meta", payment.id, purchase.slug, out.events_received);
    return { sent: true };
  } catch (e) {
    await redis("DEL", `capi:${payment.id}`); // así el próximo aviso de Mercado Pago lo reintenta
    throw e;
  }
}

/* ---------- Todo junto: lo que pasa cuando un pago queda aprobado ---------- */
// fromWebhook: el Purchase del servidor se manda solo desde el webhook (una vez por pago).
export async function processPayment(payment, { fromWebhook = false } = {}) {
  const info = parseRef(payment.external_reference);
  if (!info) return { status: payment.status, ours: false };
  const order = await loadOrder(info, payment);
  if (!isPaid(payment, info)) return { status: payment.status, ours: true, info, order };

  const purchase = await recordPurchase(payment, info, order);
  if (fromWebhook) await sendPurchaseCAPI(payment, purchase, order).catch((e) => console.error(e.message));
  if (await once(`mail:${payment.id}`)) await sendDelivery(purchase, { notifyOwner: true });
  return { status: payment.status, ours: true, paid: true, info, order, purchase };
}

export { clientIp, env };
