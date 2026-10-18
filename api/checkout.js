import { SITE, body, clientIp, normEmail, validEmail, randomToken } from "./_lib/util.js";
import { mp } from "./_lib/mp.js";
import { hset, redis } from "./_lib/db.js";
import { productoActivo } from "./_lib/catalogo.js";
import { encodeRef } from "./_lib/ventas.js";
import { privatePdfExists } from "./_lib/pdf.js";

// POST /api/checkout  {producto, email, cta, landing, fbp, fbc}
// Guarda el pedido (mail incluido) ANTES de ir a pagar y devuelve la URL de pago de Mercado Pago.
export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "Método no permitido" });
  const b = body(req);

  const prod = productoActivo(String(b.producto || "dados"));
  if (!prod) return res.status(400).json({ error: "Ese ebook no existe" });
  // No cobrar un ebook cuyo PDF todavía no se subió desde /admin (dados tiene además el PDF viejo en PDF_URL)
  if (!(prod.slug === "dados" && process.env.PDF_URL) && !(await privatePdfExists(prod.pdf)))
    return res.status(409).json({ error: "Este ebook sale a la venta en unos minutos. Probá de nuevo más tarde." });

  // Landings viejas (todavía abiertas en algún celu) mandan {channel, value}
  let email = normEmail(b.email || (b.channel === "email" ? b.value : ""));
  const whatsapp = b.channel === "whatsapp" ? String(b.value || "").replace(/\D/g, "") : "";
  if (!validEmail(email)) {
    if (!/^549\d{10}$/.test(whatsapp)) return res.status(400).json({ error: "Revisá tu mail" });
    email = "";
  }

  const landing = String(b.landing || "a").toLowerCase() === "b" ? "b" : "a";
  const variante = landing.toUpperCase();
  const cta = String(b.cta || "").replace(/[^a-z0-9_-]/gi, "").slice(0, 20) || "na";
  const cookie = (v) => (/^fb\.\d\.\d+\.[\w.-]{1,250}$/.test(String(v || "")) ? String(v) : undefined);
  const order = {
    slug: prod.slug, email, whatsapp: whatsapp || undefined, variante, cta,
    fbp: cookie(b.fbp), fbc: cookie(b.fbc), ip: clientIp(req) || undefined,
    ua: String(req.headers["user-agent"] || "").slice(0, 400) || undefined, creado: new Date().toISOString(),
  };
  const orderId = randomToken(16);
  const site = SITE();

  try {
    await hset(`order:${orderId}`, order);
    await redis("EXPIRE", `order:${orderId}`, 60 * 60 * 24 * 120);

    const back = `${site}/gracias?p=${prod.slug}&v=${landing}`;
    const pref = await mp("/checkout/preferences", {
      method: "POST",
      body: JSON.stringify({
        items: [{
          id: prod.slug, title: `${prod.titulo} · Ebook imprimible`, description: "Ebook imprimible PDF",
          quantity: 1, unit_price: Number(prod.precio), currency_id: "ARS",
        }],
        external_reference: encodeRef(prod.slug, orderId),
        // Copia de respaldo del pedido dentro del pago
        metadata: { producto: prod.slug, email, landing, cta_variant: cta, fbp: order.fbp, fbc: order.fbc, client_ip: order.ip, client_ua: order.ua },
        back_urls: { success: back, pending: back, failure: back },
        auto_return: "approved",
        notification_url: `${site}/api/webhook`,
        statement_descriptor: "LUDOLAB",
      }),
    });
    return res.status(200).json({ url: pref.init_point });
  } catch (e) {
    console.error(e);
    return res.status(502).json({ error: "No pudimos crear el pago", detail: String(e.message || e).slice(0, 300) });
  }
}
