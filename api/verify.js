import { getPayment, isValidPurchase, decodeRef, downloadUrl, sendPurchaseOnce, claimOnce } from "./_lib/shared.js";

// GET /api/verify?payment_id=123  (la usa gracias.html para mostrar el botón de descarga al instante)
export default async function handler(req, res) {
  const id = String(req.query.payment_id || "").replace(/\D/g, "");
  if (!id) return res.status(400).json({ error: "Falta payment_id" });
  try {
    const p = await getPayment(id);
    const contact = decodeRef(p.external_reference);
    if (!contact) return res.status(404).json({ error: "Pago no encontrado" });
    const valid = isValidPurchase(p);
    if (valid) {
      // Por si el aviso de Mercado Pago todavía no llegó: si ya se mandó, no se repite
      await sendPurchaseOnce(p, req).catch((e) => console.error(e.message));
    }
    return res.status(200).json({
      status: p.status,
      channel: contact.channel,
      amount: p.transaction_amount,
      cta: p.metadata?.cta_variant || null,
      landing: p.metadata?.landing || null,
      variante: contact.variante || (String(p.metadata?.landing || "").toLowerCase() === "b" ? "B" : "A"),
      // true solo la primera vez que se abre la página de descarga de este pago (en cualquier dispositivo)
      trackPixel: valid ? await claimOnce("pixel", p.id) : false,
      downloadUrl: valid ? downloadUrl(p.id) : null,
    });
  } catch (e) {
    console.error(e);
    return res.status(404).json({ error: "Pago no encontrado" });
  }
}
