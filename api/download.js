import crypto from "node:crypto";
import { env, hmac } from "./_lib/util.js";
import { producto } from "./_lib/catalogo.js";
import { signedPdfUrl, privateToken } from "./_lib/pdf.js";

// GET /api/download?t=...  Links de descarga VIEJOS (mails de antes de ludolab.app, válidos 7 días).
function readToken(t = "") {
  const [payload, sig] = String(t).split(".");
  if (!payload || !sig) return null;
  const expected = hmac(payload);
  if (sig.length !== expected.length || !crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) return null;
  const [paymentId, exp] = Buffer.from(payload, "base64url").toString().split(".");
  if (!paymentId || Date.now() > Number(exp)) return null;
  return { paymentId };
}

export default async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");
  if (!readToken(req.query.t)) {
    res.setHeader("Content-Type", "text/html; charset=utf-8");
    return res.status(403).send(`<p style="font-family:sans-serif">Este link venció. Pedí uno nuevo (que no vence) en <a href="https://ludolab.app/recuperar">ludolab.app/recuperar</a>.</p>`);
  }
  const url = privateToken() ? await signedPdfUrl(producto("dados").pdf) : env("PDF_URL");
  return res.redirect(302, url);
}
