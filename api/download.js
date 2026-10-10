import { env, readToken } from "./_lib/shared.js";

// GET /api/download?t=...  Link firmado que vence a los 7 días. Redirige al PDF.
export default async function handler(req, res) {
  const tok = readToken(req.query.t);
  if (!tok) {
    res.setHeader("Content-Type", "text/html; charset=utf-8");
    return res.status(403).send(`<p style="font-family:sans-serif">Este link venció o no es válido. Escribinos y te mandamos uno nuevo.</p>`);
  }
  res.setHeader("Cache-Control", "no-store");
  return res.redirect(302, env("PDF_URL"));
}
