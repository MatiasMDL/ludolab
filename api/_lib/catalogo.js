import fs from "node:fs";
import path from "node:path";

// Catálogo de ebooks: un solo archivo, productos.json en la raíz del sitio.
let cache;
export function catalogo() {
  if (!cache) cache = JSON.parse(fs.readFileSync(path.join(process.cwd(), "productos.json"), "utf8"));
  return cache;
}
export const productos = () => catalogo().productos;
// Para vender: solo productos activos. Para entregar: cualquiera (un ebook dado de baja se sigue pudiendo abrir).
export const producto = (slug) => productos().find((p) => p.slug === slug) || null;
export const productoActivo = (slug) => productos().find((p) => p.slug === slug && p.activo !== false) || null;
// Complemento (order bump): se ofrece en la compra de otro ebook y no se vende solo.
export const esComplemento = (p) => p?.tipo === "complemento";
export function complementoDe(prod) {
  const c = prod?.complemento && productoActivo(prod.complemento);
  return esComplemento(c) ? c : null;
}
