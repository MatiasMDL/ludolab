import { handleUpload } from "@vercel/blob/client";
import { body, clientIp, safeEqual } from "./_lib/util.js";
import { hasDb, rateLimit } from "./_lib/db.js";
import { productos } from "./_lib/catalogo.js";
import { privateToken } from "./_lib/pdf.js";

// POST /api/admin-subir  (lo llama /admin con el header x-admin-password)
// PDFs de más de 3,3 MB: el navegador los sube directo al Blob privado. Acá solo damos el permiso,
// y únicamente para la ruta del PDF de un ebook del catálogo.
export default async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");
  if (req.method !== "POST") return res.status(405).json({ error: "Método no permitido" });
  const pass = process.env.ADMIN_PASSWORD || "";
  if (pass.length < 10) return res.status(503).json({ error: "Falta configurar ADMIN_PASSWORD (mínimo 10 caracteres) en Vercel" });
  if (hasDb() && !(await rateLimit(`rl:admin:${clientIp(req)}`, 60, 900))) return res.status(429).json({ error: "Demasiados intentos. Esperá 15 minutos." });
  if (!safeEqual(req.headers["x-admin-password"] || "", pass)) return res.status(401).json({ error: "Contraseña incorrecta" });
  if (!privateToken()) return res.status(400).json({ error: "Falta EBOOKS_READ_WRITE_TOKEN" });

  try {
    const out = await handleUpload({
      body: body(req),
      request: req,
      token: privateToken(),
      onBeforeGenerateToken: async (pathname) => {
        if (!productos().some((p) => p.pdf === pathname)) throw new Error("Esa ruta no es la de ningún ebook");
        return { allowedContentTypes: ["application/pdf"], maximumSizeInBytes: 60 * 1024 * 1024, addRandomSuffix: false, allowOverwrite: true };
      },
    });
    return res.status(200).json(out);
  } catch (e) {
    console.error(e);
    return res.status(400).json({ error: String(e.message || e).slice(0, 300) });
  }
}
