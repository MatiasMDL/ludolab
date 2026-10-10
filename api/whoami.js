import { mp } from "./_lib/shared.js";

// GET /api/whoami  Diagnóstico temporal: muestra a qué cuenta de Mercado Pago pertenece el token cargado.
export default async function handler(req, res) {
  try {
    const u = await mp("/users/me");
    return res.status(200).json({
      ok: true,
      id: u.id,
      nickname: u.nickname,
      site_id: u.site_id,
      cuenta_de_prueba: /^TEST/i.test(u.nickname || "") || (u.tags || []).includes("test_user"),
      tags: u.tags,
    });
  } catch (e) {
    return res.status(200).json({ ok: false, error: String(e.message || e).slice(0, 300) });
  }
}
