# Píxel de Meta · código final y prueba

Píxel único: `4240054562902602`. Publicado en https://ludolab-cyan.vercel.app (commit f7c65ec). Las páginas completas están en el repo: `index.html` (A), `b.html` (B), `gracias.html` (descarga).

## 1. `<head>` de las tres páginas
```html
<!-- Meta Pixel -->
<script>
!function(f,b,e,v,n,t,s){if(f.fbq)return;n=f.fbq=function(){n.callMethod?
n.callMethod.apply(n,arguments):n.queue.push(arguments)};if(!f._fbq)f._fbq=n;
n.push=n;n.loaded=!0;n.version='2.0';n.queue=[];t=b.createElement(e);t.async=!0;
t.src=v;s=b.getElementsByTagName(e)[0];s.parentNode.insertBefore(t,s)}(window,
document,'script','https://connect.facebook.net/en_US/fbevents.js');
fbq('init', '4240054562902602');
fbq('track', 'PageView');
</script>
<noscript><img height="1" width="1" style="display:none" src="https://www.facebook.com/tr?id=4240054562902602&ev=PageView&noscript=1"/></noscript>
<!-- End Meta Pixel -->
```

## 2. Landing A (`index.html`): eventos
En B (`b.html`) es idéntico con `const VARIANTE = "B";`.
```js
const PIXEL_ID = "4240054562902602";   // el código base del píxel está en el <head>
const VARIANTE = "A";                 // versión de la landing para el A/B (va en todos los eventos)
function track(ev, data) { try { window.fbq && window.fbq("track", ev, Object.assign({}, data, {variante: VARIANTE})); } catch (e) {} }
track("ViewContent", {content_name: "100 juegos con dados", value: CONFIG.price, currency: "ARS"});
// ... dentro del submit, después de validar el email o WhatsApp:
  // Coincidencia avanzada: solo el dato que dejó (el píxel lo hashea antes de enviarlo)
  try { window.fbq && fbq("init", PIXEL_ID, contact.channel === "email" ? {em: contact.value} : {ph: contact.value}); } catch (e) {}
  track("Lead", {content_name: "100 juegos con dados"});
// ... cuando Mercado Pago devolvió el link de pago:
    track("InitiateCheckout", {value: CONFIG.price, currency: "ARS", num_items: 1, cta_variant: ctaVariant});
    setTimeout(() => { window.location.href = data.url; }, 300);   // le da tiempo al píxel a enviar el evento
```

## 3. Página de descarga (`gracias.html`)
```js
function trackPurchase(d) {
  const key = "fb_purchase_" + paymentId;
  try { if (localStorage.getItem(key)) return; } catch (e) {}
  const variante = String(d.landing || q.get("l") || "a").toUpperCase() === "B" ? "B" : "A";
  try {
    window.fbq && fbq("track", "Purchase",
      {value: Number(d.amount) || 11999, currency: "ARS", content_name: "100 juegos con dados", num_items: 1, variante: variante, cta_variant: d.cta},
      {eventID: "mp_" + paymentId});
    localStorage.setItem(key, "1");
  } catch (e) {}
}
```
`trackPurchase(d)` se llama solo cuando `/api/verify` (función de Vercel) consultó el pago en la API de Mercado Pago y dio `approved`. Si está pendiente muestra "Tu pago está pendiente" sin botón; si fue rechazado, "El pago no se aprobó" con "Intentar de nuevo".

La variante viaja en el pago de Mercado Pago (`metadata.landing`) y en la URL de vuelta (`/gracias?l=a` o `?l=b`). No la puse en `external_reference` porque ahí va el email o WhatsApp del comprador, que usa la entrega.

## 4. Prueba con Meta Pixel Helper
| Paso | Qué tiene que aparecer |
|---|---|
| Abrir https://ludolab-cyan.vercel.app/ | PageView y ViewContent con `variante: A` |
| Abrir https://ludolab-cyan.vercel.app/b | PageView y ViewContent con `variante: B` |
| Tocar un botón "Quiero el ebook ahora" | CTAClick (personalizado) |
| Poner un email o WhatsApp inválido y pagar | Nada nuevo (sale el error rojo) |
| Poner uno válido y tocar Pagar | Lead, y enseguida InitiateCheckout (`value 11999`, `num_items 1`), y abre Mercado Pago |
| Pagar y volver a /gracias | PageView y Purchase (`eventID mp_<número de pago>`) |
| Recargar /gracias | Solo PageView, sin otro Purchase |
| Abrir /gracias sin pagar o con un pago pendiente | Solo PageView, sin botón de descarga |

## 5. Seguridad del PDF
Abrir la página de descarga **no** alcanza para bajar el PDF. El botón aparece solo si `/api/verify` consulta el `payment_id` en la API de Mercado Pago (con el token, del lado del servidor) y el pago es de este ebook, está aprobado y es por el precio completo. Entonces entrega un link firmado que vence a los 7 días. Inventar un `payment_id` o poner `status=approved` en la URL no sirve.

Punto débil: `/api/download` redirige a la URL pública del PDF en Vercel Blob. Quien compra puede copiar esa URL y compartirla, y esa URL no vence. Cómo cerrarlo de la forma más simple: subir el PDF de nuevo con un nombre aleatorio, borrar el viejo, actualizar `PDF_URL` y que la función mande el archivo en vez de redirigir, para que la URL real nunca se vea.
