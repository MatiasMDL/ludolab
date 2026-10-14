import { producto } from "./_lib/catalogo.js";
import { signedPdfUrl } from "./_lib/pdf.js";
import { buyerByToken, comprasDe } from "./_lib/compras.js";

// GET /api/pdf?t=<token>&p=<slug>  → verifica que ese comprador tenga ese ebook y redirige
// a un link firmado del Blob privado que vence en 10 minutos.
export default async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");
  const slug = String(req.query.p || "");
  try {
    const email = await buyerByToken(req.query.t);
    const prod = producto(slug);
    if (!email || !prod) return res.status(404).send("No encontrado");
    const compras = await comprasDe(email);
    if (!compras.some((c) => c.slug === slug)) return res.status(403).send("Este ebook no está en tu cuenta");
    return res.redirect(302, await signedPdfUrl(prod.pdf));
  } catch (e) {
    console.error(e);
    return res.status(500).send("No pudimos abrir el PDF. Probá de nuevo en un momento.");
  }
}
