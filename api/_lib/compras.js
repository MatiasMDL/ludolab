import { redis, pipeline, toObj } from "./db.js";
import { producto } from "./catalogo.js";

// Todas las compras de un comprador a partir de su token (link /mi-ebook/<token>)
export async function buyerByToken(token) {
  if (!/^[A-Za-z0-9_-]{20,64}$/.test(String(token || ""))) return null;
  const email = await redis("GET", `token:${token}`);
  return email || null;
}

export async function comprasDe(email) {
  const pids = (await redis("SMEMBERS", `buyer:${email}:compras`)) || [];
  const rows = await pipeline(pids.map((pid) => ["HGETALL", `purchase:${pid}`]));
  return rows.map(toObj).filter(Boolean).sort((a, b) => String(b.fecha).localeCompare(String(a.fecha)));
}

// Un ebook por producto (si compró dos veces el mismo, se ve una vez)
export function ebooksDe(compras) {
  const seen = new Set();
  return compras.filter((c) => !seen.has(c.slug) && seen.add(c.slug)).map((c) => ({ slug: c.slug, prod: producto(c.slug), compra: c }))
    .filter((x) => x.prod);
}
