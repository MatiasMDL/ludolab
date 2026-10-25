import { getPayment } from "./_lib/mp.js";
import { once } from "./_lib/db.js";
import { maskEmail, normEmail } from "./_lib/util.js";
import { processPayment, parseRef } from "./_lib/ventas.js";
import { producto } from "./_lib/catalogo.js";

// GET /api/verify?payment_id=123&ref=dados|abc  (la usa /gracias)
// Si el pago está aprobado devuelve el link personal /mi-ebook/<token>.
export default async function handler(req, res) {
  const id = String(req.query.payment_id || "").replace(/\D/g, "");
  if (!id) return res.status(400).json({ error: "Falta payment_id" });
  try {
    const p = await getPayment(id);
    const info = parseRef(p.external_reference);
    // Pagos nuevos: además del número de pago hay que tener la referencia del pedido (va en la URL de vuelta)
    if (!info || (info.orderId && String(req.query.ref || "") !== p.external_reference)) return res.status(404).json({ error: "Pago no encontrado" });

    const r = await processPayment(p);
    const out = { status: p.status, slug: info.slug, titulo: producto(info.slug)?.titulo, variante: r.order?.variante || "A", amount: p.transaction_amount };
    if (r.purchase?.complemento) out.complemento = r.purchase.complemento;
    if (r.paid) {
      out.url = `/mi-ebook/${r.purchase.token}`;
      out.eventId = `mp_${p.id}`;
      out.trackPixel = await once(`pixel:${p.id}`); // el Purchase del navegador sale una sola vez por pago
    } else {
      out.email = maskEmail(normEmail(r.order?.email || p.payer?.email));
    }
    return res.status(200).json(out);
  } catch (e) {
    console.error(e);
    return res.status(500).json({ error: "No pudimos consultar el pago" });
  }
}
