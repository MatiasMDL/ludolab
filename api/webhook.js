import crypto from "node:crypto";
import { getPayment } from "./_lib/mp.js";
import { processPayment } from "./_lib/ventas.js";

// POST /api/webhook  (notification_url de cada pago, igual para todos los ebooks)
// Mercado Pago avisa cada cambio de un pago. Si quedó aprobado: guarda la compra, manda el Purchase a Meta
// una sola vez y manda el mail con el link personal una sola vez.
export default async function handler(req, res) {
  const b = typeof req.body === "string" ? JSON.parse(req.body || "{}") : req.body || {};
  const type = b.type || req.query.type || req.query.topic;
  const id = b?.data?.id || req.query["data.id"] || req.query.id;
  if (type !== "payment" || !id) return res.status(200).send("ignorado");

  const secret = process.env.MP_WEBHOOK_SECRET;
  if (secret) {
    const parts = Object.fromEntries(String(req.headers["x-signature"] || "").split(",").map((p) => p.trim().split("=")));
    const manifest = `id:${String(req.query["data.id"] || id).toLowerCase()};request-id:${req.headers["x-request-id"] || ""};ts:${parts.ts};`;
    const expected = crypto.createHmac("sha256", secret).update(manifest).digest("hex");
    if (!parts.v1 || parts.v1 !== expected) return res.status(401).send("firma inválida");
  }

  try {
    const payment = await getPayment(id); // nunca confiamos en el cuerpo del aviso
    const r = await processPayment(payment, { fromWebhook: true });
    console.log("Webhook", id, r.status, r.paid ? "entregado" : "");
    return res.status(200).send("ok");
  } catch (e) {
    console.error(e);
    return res.status(500).send("error"); // Mercado Pago reintenta
  }
}
