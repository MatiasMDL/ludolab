import { redis } from "./_lib/db.js";
import { maskEmail } from "./_lib/util.js";
import { buyerByToken, comprasDe, ebooksDe } from "./_lib/compras.js";

// GET /api/mi-ebook?t=<token>  → los ebooks de ese comprador (la página /mi-ebook/<token>)
export default async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");
  const t = String(req.query.t || "");
  try {
    const email = await buyerByToken(t);
    if (!email) return res.status(404).json({ error: "Link no encontrado" });
    const ebooks = ebooksDe(await comprasDe(email));
    if (req.query.visita === "1") await redis("HINCRBY", `buyer:${email}`, "aperturas", 1);
    return res.status(200).json({
      email: maskEmail(email),
      ebooks: ebooks.map(({ slug, prod }) => ({
        slug, titulo: prod.titulo, tapa: prod.tapa, archivo: `${prod.titulo}.pdf`,
        pdf: `/api/pdf?t=${encodeURIComponent(t)}&p=${encodeURIComponent(slug)}`,
      })),
    });
  } catch (e) {
    console.error(e);
    return res.status(500).json({ error: "No pudimos cargar tu ebook" });
  }
}
