# Landing LudoLab · 100 juegos con dados

Landing de una sola página con fotos reales del libro (carpeta `img/`) que cobra con Mercado Pago (Checkout Pro) y entrega el PDF al instante.

## Dos versiones para A/B

- **A** (`/`, `index.html`): página larga, ángulo "menos pantallas", contador y varios botones.
- **B** (`/b`, `b.html`): ángulo "aprenden jugando", el formulario de pago está en la primera pantalla.

Las dos usan el mismo backend y el mismo Mercado Pago. Cada pago guarda en `metadata` qué landing (`landing: a|b`) y qué texto de botón (`cta_variant`) vio el comprador, y los mismos datos van al píxel de Meta. En Meta Ads: un conjunto de anuncios con URL `https://tudominio/` y otro con `https://tudominio/b`.

Si cambiás precio, fecha de promo, píxel o reseñas, hacelo en el `CONFIG` de **los dos** archivos.

## Cómo funciona la compra

1. La persona elige **Email** o **WhatsApp** y escribe solo ese dato.
2. `POST /api/checkout` crea la preferencia en Mercado Pago (el contacto viaja en `external_reference`) y la redirige al checkout.
3. Paga con tarjeta, débito, dinero en cuenta o efectivo.
4. Mercado Pago la devuelve a `/gracias`, que consulta `/api/verify` y muestra **el botón de descarga en el momento**.
5. En paralelo, Mercado Pago avisa a `/api/webhook`, que vuelve a consultar el pago y manda el link:
   - **Email:** automático con Resend.
   - **WhatsApp:** automático si configurás la API de WhatsApp de Meta. Si no, te llega un email a vos con un botón que abre WhatsApp con el mensaje y el link ya escritos (un toque y listo).
6. El link de descarga está firmado y vence a los 7 días.

## Archivos

| Archivo | Qué hace |
|---|---|
| `index.html` | La landing. Arriba del `<script>` está `CONFIG`: precio, WhatsApp de ayuda, píxel de Meta, y bloques opcionales (precio tachado, garantía, bonus, fotos de páginas, testimonios). |
| `gracias.html` | Página de vuelta de Mercado Pago con el botón de descarga. Poné tu WhatsApp en `SUPPORT_WA`. |
| `api/checkout.js` | Crea el pago en Mercado Pago. |
| `api/webhook.js` | Recibe el aviso de pago aprobado y entrega el ebook. |
| `api/verify.js` | Confirma el pago para la página de gracias. |
| `api/download.js` | Valida el link firmado y redirige al PDF. |
| `api/_lib/shared.js` | Funciones compartidas (Mercado Pago, firma, email, WhatsApp). |
| `.env.example` | Todas las variables que hay que cargar. |

Sin dependencias: Node 18+ con `fetch` nativo.

## Lo que necesitás para publicarla

1. **Mercado Pago:** en [Tus integraciones](https://www.mercadopago.com.ar/developers/panel/app) creá una aplicación (Checkout Pro) y copiá el **Access Token de producción** → `MP_ACCESS_TOKEN`. En la sección Webhooks copiá la **clave secreta** → `MP_WEBHOOK_SECRET`.
2. **Hosting:** una cuenta gratis en [Vercel](https://vercel.com). Subís esta carpeta (o la conectás a un repo de GitHub), cargás las variables de `.env.example` en *Settings → Environment Variables* y deploy.
3. **Dominio** (opcional pero suma confianza): por ejemplo `ludolab.com.ar` en NIC Argentina, conectado a Vercel. Va en `SITE_URL`.
4. **El PDF:** subilo a Vercel Blob (o un link de Google Drive) con un nombre difícil de adivinar → `PDF_URL`.
5. **Email:** cuenta gratis en [Resend](https://resend.com), verificás tu dominio y copiás la API key → `RESEND_API_KEY`, `EMAIL_FROM`. Poné tu email en `OWNER_EMAIL` para enterarte de cada venta.
6. **WhatsApp automático** (opcional): WhatsApp Business Platform de Meta con una plantilla aprobada de una variable (el link). Mientras no esté, las ventas por WhatsApp te llegan por email para mandar con un toque.
7. `DOWNLOAD_SECRET`: cualquier texto largo y aleatorio.

## Probar antes de cobrar de verdad

Usá las **credenciales de prueba** de Mercado Pago y sus [tarjetas de prueba](https://www.mercadopago.com.ar/developers/es/docs/checkout-pro/additional-content/your-integrations/test/cards). Con el token de prueba no se cobra nada.

## Cosas a tener en cuenta

- `PRICE_ARS` (backend) y `CONFIG.price` (landing) tienen que ser el mismo número. El que manda es el del backend.
- Mercado Pago puede avisar dos veces por el mismo pago; en ese caso el comprador recibiría el link dos veces. Si molesta, se agrega una base chica (Vercel KV) para recordar qué pagos ya se entregaron.
- Pagos en efectivo: el ebook llega cuando Mercado Pago acredita el pago (la página de gracias lo explica).
- Activá los bloques de garantía, precio tachado y testimonios solo con datos reales.
