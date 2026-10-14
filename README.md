# LudoLab Ebooks · ludolab.app

Sitio de venta de ebooks imprimibles. Páginas estáticas + funciones de Vercel. Cobra con Mercado Pago (Checkout Pro) y entrega solo: el webhook manda un link personal y permanente `/mi-ebook/<token>`.

## Páginas

| Ruta | Archivo | Qué es |
|---|---|---|
| `/` | `index.html` | Portal con todos los ebooks (lee `productos.json`) |
| `/<slug>` y `/<slug>/a` | `<slug>/a.html` | Landing A del ebook |
| `/<slug>/b` | `<slug>/b.html` | Landing B (test A/B) |
| `/gracias` | `gracias.html` | Vuelta de Mercado Pago: si está aprobado abre `/mi-ebook/<token>`, si está pendiente espera y redirige sola |
| `/mi-ebook/<token>` | `mi-ebook.html` | Los ebooks del comprador: visor, Imprimir y Guardar |
| `/recuperar` | `recuperar.html` | Reenvía el link al mail (máx. 3 por hora) |
| `/admin` | `admin.html` | Panel con contraseña: ventas, aperturas, reenviar |
| `/terminos`, `/privacidad`, `/contacto` | | Legales y botón de arrepentimiento |

`ludolab-cyan.vercel.app` redirige con 301 a `ludolab.app` (conservando `fbclid` y `utm_*`), menos `/api/*`, para que los pagos y avisos viejos sigan funcionando.

## Cómo agregar un ebook nuevo

1. **PDF:** en Vercel → Storage → el Blob privado de ebooks → subí el PDF como `ebooks/<slug>.pdf` (por ejemplo `ebooks/mandalas.pdf`).
2. **Tapa:** guardá la foto en `img/` (por ejemplo `img/mandalas.jpg`), vertical o 4:3.
3. **Catálogo:** agregá un registro en `productos.json` copiando el de `dados` y cambiando: `slug`, `titulo`, `subtitulo`, `categoria` (`chicos` o `adultos`), `para_quien`, `precio`, `precio_tachado`, `tapa`, `pdf` y los textos de `mail`.
4. **Landing:** copiá la carpeta `dados/` como `<slug>/` y en `a.html` (y `b.html` si hacés test) cambiá textos, fotos, `const PRODUCTO = "<slug>"` y el `price`/`anchorPrice` del `CONFIG`.
5. Subí los cambios a GitHub: Vercel publica solo. El ebook aparece en el portal y se cobra con el precio del catálogo.

## Cómo se entrega

1. La landing guarda el pedido (mail, variante, cookies del píxel) en la base y crea el pago con `external_reference = <slug>|<orden>`.
2. Mercado Pago avisa a `/api/webhook`. Si el pago quedó `approved` y es por el precio del catálogo: guarda la compra, manda el **Purchase** a Meta (API de conversiones, `event_id = mp_<pago>`) una sola vez, y manda el mail "Tu ebook … – acá está tu link" una sola vez, con copia oculta a `OWNER_EMAIL` y aviso aparte "Venta #… – … – mail ENVIADO/FALLÓ" (2 reintentos).
3. `/gracias` consulta el pago, dispara el Purchase del navegador con el mismo `event_id` (una sola vez) y abre `/mi-ebook/<token>`.
4. El PDF vive en un Blob **privado**: `/api/pdf` verifica el token y da un link firmado que vence a los 10 minutos.

## Variables de entorno (Vercel → Settings → Environment Variables)

| Variable | Para qué |
|---|---|
| `MP_ACCESS_TOKEN`, `MP_WEBHOOK_SECRET` | Mercado Pago |
| `SITE_URL` | `https://ludolab.app` |
| `KV_REST_API_URL`, `KV_REST_API_TOKEN` | Base Upstash Redis (las crea Vercel al conectarla) |
| `EBOOKS_READ_WRITE_TOKEN` | Blob privado de los PDFs (prefijo `EBOOKS` al conectarlo) |
| `RESEND_API_KEY`, `EMAIL_FROM` | Mails (`LudoLab Ebooks <hola@ludolab.app>`) |
| `OWNER_EMAIL` | Copia oculta y aviso de cada venta |
| `REPLY_TO` | Opcional: a dónde van las respuestas de los compradores |
| `META_CAPI_TOKEN`, `META_TEST_EVENT_CODE` | API de conversiones de Meta (el segundo, solo para probar) |
| `ADMIN_PASSWORD` | Contraseña de `/admin` (mínimo 10 caracteres) |
| `DOWNLOAD_SECRET`, `PDF_URL` | Solo para los links de descarga viejos y para copiar el PDF al Blob privado |
