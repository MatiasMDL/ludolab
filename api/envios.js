import crypto from "node:crypto";
import { listDeliveries } from "./_lib/shared.js";

// GET /api/envios?key=...  Registro de los últimos envíos del ebook (solo con la clave ENVIOS_KEY).
export default async function handler(req, res) {
  const key = process.env.ENVIOS_KEY || "";
  const given = String(req.query.key || "");
  const ok = key.length >= 12 && given.length === key.length && crypto.timingSafeEqual(Buffer.from(given), Buffer.from(key));
  if (!ok) return res.status(404).send("No encontrado");

  const rows = await listDeliveries(200).catch((e) => [{ error: e.message }]);
  if (req.query.format === "json") return res.status(200).json(rows);

  const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
  const cols = ["hora_ar", "payment_id", "mail", "whatsapp", "mail_mercadopago", "landing", "estado", "respuesta", "error"];
  res.setHeader("Content-Type", "text/html; charset=utf-8");
  res.setHeader("Cache-Control", "no-store");
  return res.status(200).send(`<!doctype html><meta charset="utf-8"><meta name="robots" content="noindex"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Envíos · LudoLab</title>
<style>body{font:14px system-ui,sans-serif;margin:16px;background:#fff;color:#18181B}table{border-collapse:collapse;width:100%}td,th{border-bottom:1px solid #ddd;padding:6px 8px;text-align:left;vertical-align:top}th{background:#f4f1ea}.FALLÓ{color:#b8261e;font-weight:700}.ENVIADO{color:#1f8e74;font-weight:700}div{overflow-x:auto}</style>
<h1>Envíos del ebook</h1><div><table><tr>${cols.map((c) => `<th>${c}</th>`).join("")}</tr>
${rows.map((r) => `<tr>${cols.map((c) => `<td class="${c === "estado" ? esc(r.estado) : ""}">${esc(r[c])}</td>`).join("")}</tr>`).join("")}
</table></div>`);
}
