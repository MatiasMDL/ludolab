import { env } from "./util.js";

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
  if (!r.ok) throw new Error(`Mercado Pago ${r.status}: ${JSON.stringify(data).slice(0, 300)}`);
  return data;
}

export const getPayment = (id) => mp(`/v1/payments/${encodeURIComponent(id)}`);
