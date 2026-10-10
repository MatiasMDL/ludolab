import { getPayment, isValidPurchase, decodeRef, downloadUrl } from "./_lib/shared.js";

// GET /api/verify?payment_id=123  (la usa gracias.html para mostrar el botón de descarga al instante)
export default async function handler(req, res) {
  const id = String(req.query.payment_id || "").replace(/\D/g, "");
  if (!id) return res.status(400).json({ error: "Falta payment_id" });
  try {
    const p = await getPayment(id);
    const contact = decodeRef(p.external_reference);
    if (!contact) return res.status(404).json({ error: "Pago no encontrado" });
    return res.status(200).json({
      status: p.status,
      channel: contact.channel,
      amount: p.transaction_amount,
      cta: p.metadata?.cta_variant || null,
      landing: p.metadata?.landing || null,
      downloadUrl: isValidPurchase(p) ? downloadUrl(p.id) : null,
    });
  } catch (e) {
    console.error(e);
    return res.status(404).json({ error: "Pago no encontrado" });
  }
}
