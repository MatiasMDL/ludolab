import { put } from "@vercel/blob";
import { body, clientIp, safeEqual, env } from "./_lib/util.js";
import { redis, pipeline, toObj, hasDb, rateLimit } from "./_lib/db.js";
import { productos, producto } from "./_lib/catalogo.js";
import { privateToken, privatePdfExists } from "./_lib/pdf.js";
import { sendDelivery } from "./_lib/ventas.js";

// POST /api/admin  {accion, ...}  con el header x-admin-password = ADMIN_PASSWORD
export default async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");
  if (req.method !== "POST") return res.status(405).json({ error: "Método no permitido" });
  const pass = process.env.ADMIN_PASSWORD || "";
  if (pass.length < 10) return res.status(503).json({ error: "Falta configurar ADMIN_PASSWORD (mínimo 10 caracteres) en Vercel" });

  const ip = clientIp(req);
  if (hasDb() && !(await rateLimit(`rl:admin:${ip}`, 60, 900))) return res.status(429).json({ error: "Demasiados intentos. Esperá 15 minutos." });
  if (!safeEqual(req.headers["x-admin-password"] || "", pass)) return res.status(401).json({ error: "Contraseña incorrecta" });

  const b = body(req);
  try {
    if (b.accion === "estado") {
      return res.json({
        base: hasDb(), resend: Boolean(process.env.RESEND_API_KEY), remitente: process.env.EMAIL_FROM || "",
        pdfPrivado: Boolean(privateToken()), metaCapi: Boolean(process.env.META_CAPI_TOKEN),
        copiaA: process.env.OWNER_EMAIL ? "configurado" : "", sitio: process.env.SITE_URL || "",
        productos: await Promise.all(productos().map(async (p) => ({
          slug: p.slug, titulo: p.titulo + (p.tipo === "complemento" ? " (complemento)" : ""), precio: p.precio, activo: p.activo !== false, ruta: p.pdf, pdf: await privatePdfExists(p.pdf),
        }))),
      });
    }

    if (b.accion === "ventas") {
      const pids = (await redis("ZREVRANGE", "ventas", 0, 1999)) || [];
      const rows = (await pipeline(pids.map((pid) => ["HGETALL", `purchase:${pid}`]))).map(toObj).filter(Boolean);
      const opens = await pipeline(rows.map((r) => ["HGET", `buyer:${r.email}`, "aperturas"]));
      return res.json({
        ventas: rows.map((r, i) => ({
          payment_id: r.payment_id, fecha: r.fecha, slug: r.slug, complemento: r.complemento || "",
          titulo: (producto(r.slug)?.titulo || r.slug) + (r.complemento ? " + " + (producto(r.complemento)?.titulo || r.complemento) : ""),
          email: r.email, payer_email: r.payer_email, monto: Number(r.monto), variante: r.variante,
          mail_estado: r.mail_estado, mail_error: r.mail_error, mail_envios: Number(r.mail_envios || 0),
          aperturas: Number(opens[i] || 0),
        })),
      });
    }

    if (b.accion === "reenviar") {
      const pid = String(b.payment_id || "").replace(/\D/g, "");
      const purchase = toObj(await redis("HGETALL", `purchase:${pid}`));
      if (!purchase) return res.status(404).json({ error: "No encontramos esa venta" });
      const r = await sendDelivery(purchase);
      return res.json({ ok: r.mail_estado === "ENVIADO", ...r });
    }

    // Una sola vez: copia el PDF del Blob público (PDF_URL) al Blob privado
    if (b.accion === "migrar-pdf") {
      const prod = producto(String(b.slug || "dados"));
      if (!prod || !privateToken()) return res.status(400).json({ error: "Falta el producto o EBOOKS_READ_WRITE_TOKEN" });
      const r = await fetch(env("PDF_URL"));
      if (!r.ok) throw new Error(`No pude bajar PDF_URL (${r.status})`);
      const buf = Buffer.from(await r.arrayBuffer());
      await put(prod.pdf, buf, { access: "private", token: privateToken(), addRandomSuffix: false, allowOverwrite: true, contentType: "application/pdf" });
      return res.json({ ok: true, guardado: prod.pdf, bytes: buf.length });
    }

    // Sube el PDF de un ebook al Blob privado desde el panel (llega en base64; Vercel acepta hasta ~4,5 MB por pedido)
    if (b.accion === "subir-pdf") {
      const prod = producto(String(b.slug || ""));
      if (!prod || !privateToken()) return res.status(400).json({ error: "Falta el producto o EBOOKS_READ_WRITE_TOKEN" });
      const buf = Buffer.from(String(b.base64 || ""), "base64");
      if (buf.subarray(0, 5).toString() !== "%PDF-") return res.status(400).json({ error: "El archivo no es un PDF" });
      await put(prod.pdf, buf, { access: "private", token: privateToken(), addRandomSuffix: false, allowOverwrite: true, contentType: "application/pdf" });
      return res.json({ ok: true, guardado: prod.pdf, bytes: buf.length });
    }

    return res.status(400).json({ error: "Acción desconocida" });
  } catch (e) {
    console.error(e);
    return res.status(500).json({ error: String(e.message || e).slice(0, 300) });
  }
}
