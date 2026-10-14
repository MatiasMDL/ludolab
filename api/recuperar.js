import { body, clientIp, normEmail, validEmail } from "./_lib/util.js";
import { redis, rateLimit } from "./_lib/db.js";
import { comprasDe } from "./_lib/compras.js";
import { mp } from "./_lib/mp.js";
import { sendDelivery, parseRef, isPaid, loadOrder, recordPurchase } from "./_lib/ventas.js";

const RESPUESTA = "Si hay una compra con ese mail, ya te mandamos tu link. Revisá también Spam y Promociones.";

// POST /api/recuperar {email}  → reenvía el link personal (máximo 3 por hora por mail)
export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "Método no permitido" });
  const email = normEmail(body(req).email);
  if (!validEmail(email)) return res.status(400).json({ error: "Revisá el mail: parece que le falta algo." });

  try {
    if (!(await rateLimit(`rl:rec:ip:${clientIp(req)}`, 15, 3600))) return res.status(429).json({ error: "Demasiados intentos. Probá de nuevo en un rato." });
    if (!(await rateLimit(`rl:rec:${email}`, 3, 3600))) return res.status(429).json({ error: "Ya te lo mandamos 3 veces en la última hora. Revisá Spam y Promociones, o probá de nuevo más tarde." });

    // Por el mail que dejó en la landing o por el mail de su cuenta de Mercado Pago
    let buyer = (await redis("EXISTS", `buyer:${email}`)) ? email : await redis("GET", `payer:${email}`);
    if (!buyer) buyer = await legacyBuyer(email);
    if (buyer) {
      const [ultima] = await comprasDe(buyer);
      if (ultima) {
        await sendDelivery({ ...ultima, email }); // va al mail que escribió (si lo encontramos por Mercado Pago, es su cuenta)
        await redis("HINCRBY", `buyer:${buyer}`, "recuperos", 1);
      }
    }
    return res.status(200).json({ ok: true, msg: RESPUESTA });
  } catch (e) {
    console.error(e);
    return res.status(500).json({ error: "No pudimos procesarlo. Probá de nuevo en un momento." });
  }
}

// Compras hechas antes de ludolab.app: el mail viaja en external_reference, lo buscamos en Mercado Pago
async function legacyBuyer(email) {
  for (const ref of [`100-juegos-con-dados|email|${email}|A`, `100-juegos-con-dados|email|${email}|B`, `100-juegos-con-dados|email|${email}`]) {
    const r = await mp(`/v1/payments/search?status=approved&external_reference=${encodeURIComponent(ref)}`).catch(() => null);
    for (const p of r?.results || []) {
      const info = parseRef(p.external_reference);
      if (!isPaid(p, info)) continue;
      const purchase = await recordPurchase(p, info, await loadOrder(info, p));
      return purchase.email;
    }
  }
  return null;
}
