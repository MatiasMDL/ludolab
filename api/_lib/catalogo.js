import fs from "node:fs";
import path from "node:path";

// Catálogo de ebooks: un solo archivo, productos.json en la raíz del sitio.
let cache;
export function catalogo() {
  if (!cache) cache = JSON.parse(fs.readFileSync(path.join(process.cwd(), "productos.json"), "utf8"));
  return cache;
}
export const producto = (slug) => catalogo().productos.find((p) => p.slug === slug && p.activo !== false) || null;
