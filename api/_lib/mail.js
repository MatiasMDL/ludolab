import { env, esc, SITE, clean } from "./util.js";

// Manda un mail con Resend. Reintenta 2 veces si falla. Devuelve el id del envío o tira el último error.
export async function sendEmail({ to, subject, html, text, bcc }) {
  let last;
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const r = await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: { Authorization: `Bearer ${env("RESEND_API_KEY")}`, "Content-Type": "application/json" },
        body: JSON.stringify(clean({
          from: env("EMAIL_FROM", "LudoLab Ebooks <hola@ludolab.app>"),
          to: [to], bcc: bcc ? [bcc] : undefined,
          reply_to: process.env.REPLY_TO || undefined, subject, html, text,
        })),
      });
      const out = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(`Resend ${r.status}: ${out.message || JSON.stringify(out)}`);
      return out.id;
    } catch (e) {
      last = e;
      if (attempt < 3) await new Promise((ok) => setTimeout(ok, 1500 * attempt));
    }
  }
  throw last;
}

// Mail de entrega: un botón grande al link personal, el link en texto y cómo recuperarlo.
export function entregaMail(prod, link, extra) {
  const titulo = prod?.titulo || "tu ebook";
  const intro = (prod?.mail?.intro || `Acá tenés tu ebook ${titulo}.`) + (extra ? " " + (extra.mail?.intro || `Y también ${extra.titulo}.`) : "");
  const subject = prod?.mail?.asunto || `Tu ebook ${titulo} – acá está tu link`;
  const html = `
<div style="font-family:Arial,Helvetica,sans-serif;max-width:520px;margin:auto;color:#18181B;font-size:16px;line-height:1.5">
  <p style="font-size:13px;color:#56565E;letter-spacing:.08em;text-transform:uppercase;margin:0 0 6px">LudoLab Ebooks</p>
  <h1 style="font-size:26px;margin:0 0 14px">¡Gracias por tu compra!</h1>
  <p style="margin:0 0 22px">${esc(intro)}</p>
  <p style="margin:0 0 22px;text-align:center">
    <a href="${link}" style="display:block;background:#DA3229;color:#ffffff;padding:18px 20px;border-radius:999px;text-decoration:none;font-weight:bold;font-size:18px">📖 ABRIR MI EBOOK</a>
  </p>
  <p style="margin:0 0 6px;font-size:14px;color:#56565E">Si el botón no funciona, copiá este link en el navegador:</p>
  <p style="margin:0 0 18px;font-size:14px;word-break:break-all"><a href="${link}" style="color:#2350C2">${link}</a></p>
  <p style="margin:0 0 18px;padding:12px 14px;background:#F0ECE5;border-radius:12px;font-size:15px"><b>Este link es tuyo y funciona para siempre.</b> Desde ahí lo podés ver, imprimir y guardar en tu celu o tu compu.</p>
  <p style="margin:0 0 6px;font-size:13px;color:#56565E">¿Lo perdiste? Pedilo de nuevo en <a href="${SITE()}/recuperar" style="color:#2350C2">${SITE().replace(/^https?:\/\//, "")}/recuperar</a>.</p>
  <p style="margin:0 0 18px;font-size:13px;color:#56565E">Es para uso familiar o en el aula. Por favor no lo compartas ni lo revendas.</p>
  <p style="margin:0">Un abrazo,<br>LudoLab</p>
</div>`;
  const text = `¡Gracias por tu compra!\n\n${intro}\n\nAbrí tu ebook acá:\n${link}\n\nEste link es tuyo y funciona para siempre.\n\n¿Lo perdiste? Pedilo de nuevo en ${SITE()}/recuperar\n\nUn abrazo,\nLudoLab`;
  return { subject, html, text };
}
