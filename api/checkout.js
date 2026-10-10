import { env, price, mp, encodeRef } from "./_lib/shared.js";

// POST /api/checkout  {channel: "email"|"whatsapp", value}
// Crea la preferencia de Checkout Pro y devuelve la URL de pago de Mercado Pago.
export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "Método no permitido" });

  const body = typeof req.body === "string" ? JSON.parse(req.body || "{}") : req.body || {};
  const channel = body.channel;
  let value = String(body.value || "").trim().toLowerCase();

  if (channel === "email") {
    if (!/^[^\s@|]+@[^\s@|]+\.[a-z]{2,}$/i.test(value) || value.length > 120) return res.status(400).json({ error: "Email inválido" });
  } else if (channel === "whatsapp") {
    value = value.replace(/\D/g, "");
    if (!/^549\d{10}$/.test(value)) return res.status(400).json({ error: "WhatsApp inválido" });
  } else {
    return res.status(400).json({ error: "Elegí email o WhatsApp" });
  }

  const cta = String(body.cta || "").replace(/[^a-z0-9_-]/gi, "").slice(0, 20) || "na";
  const landing = String(body.landing || "").replace(/[^a-z0-9_-]/gi, "").slice(0, 20) || "na";
  const site = env("SITE_URL");
  try {
    const pref = await mp("/checkout/preferences", {
      method: "POST",
      body: JSON.stringify({
        items: [{
          id: "100-juegos-con-dados",
          title: env("PRODUCT_TITLE", "100 juegos con dados · Ebook imprimible"),
          description: "Ebook imprimible PDF A4",
          quantity: 1,
          unit_price: price(),
          currency_id: "ARS",
        }],
        ...(channel === "email" ? { payer: { email: value } } : {}),
        external_reference: encodeRef(channel, value),
        metadata: { cta_variant: cta, landing },
        back_urls: {
          success: `${site}/gracias?l=${landing}`,
          pending: `${site}/gracias?l=${landing}`,
          failure: `${site}/gracias?l=${landing}`,
        },
        auto_return: "approved",
        notification_url: `${site}/api/webhook`,
        statement_descriptor: "LUDOLAB",
      }),
    });
    return res.status(200).json({ url: pref.init_point });
  } catch (e) {
    console.error(e);
    return res.status(502).json({ error: "No pudimos crear el pago" });
  }
}
