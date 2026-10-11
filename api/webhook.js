import crypto from "node:crypto";
import { getPayment, isValidPurchase, deliver, sendPurchaseOnce } from "./_lib/shared.js";

// POST /api/webhook  (notification_url de la preferencia)
// Mercado Pago avisa acá cada cambio de un pago. Si quedó aprobado, mandamos el ebook.
export default async function handler(req, res) {
  const body = typeof req.body === "string" ? JSON.parse(req.body || "{}") : req.body || {};
  const type = body.type || req.query.type || req.query.topic;
  const id = body?.data?.id || req.query["data.id"] || req.query.id;

  if (type !== "payment" || !id) return res.status(200).send("ignorado");

  // Firma del webhook (si configuraste la clave secreta en Mercado Pago)
  const secret = process.env.MP_WEBHOOK_SECRET;
  if (secret) {
    const parts = Object.fromEntries(String(req.headers["x-signature"] || "").split(",").map((p) => p.trim().split("=")));
    const manifest = `id:${String(req.query["data.id"] || id).toLowerCase()};request-id:${req.headers["x-request-id"] || ""};ts:${parts.ts};`;
    const expected = crypto.createHmac("sha256", secret).update(manifest).digest("hex");
    if (!parts.v1 || parts.v1 !== expected) return res.status(401).send("firma inválida");
  }

  try {
    // Nunca confiamos en el cuerpo: consultamos el pago directo a Mercado Pago
    const payment = await getPayment(id);
    if (isValidPurchase(payment)) {
      // Compra para Meta (API de conversiones): una sola vez por pago
      await sendPurchaseOnce(payment).then((r) => r.skipped && console.log("Meta Purchase:", r.skipped)).catch((e) => console.error(e.message));
      const r = await deliver(payment);
      console.log("Entregado", payment.id, r);
    }
    return res.status(200).send("ok");
  } catch (e) {
    console.error(e);
    return res.status(500).send("error"); // Mercado Pago reintenta
  }
}
