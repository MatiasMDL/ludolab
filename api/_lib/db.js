// Base de datos: Upstash Redis (Vercel → Storage → Upstash for Redis), por su API REST.
const URL_ = () => process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL || process.env.STORAGE_REST_API_URL;
const TOKEN = () => process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN || process.env.STORAGE_REST_API_TOKEN;

export const hasDb = () => Boolean(URL_() && TOKEN());

async function call(path, payload) {
  if (!hasDb()) throw new Error("Falta conectar la base (Upstash Redis) al proyecto");
  const r = await fetch(URL_() + path, {
    method: "POST",
    headers: { Authorization: `Bearer ${TOKEN()}`, "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  const out = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(`Redis ${r.status}: ${JSON.stringify(out).slice(0, 200)}`);
  return out;
}

// Un comando: redis("HGETALL", "clave")
export async function redis(...cmd) {
  const out = await call("", cmd.map(String));
  if (out.error) throw new Error("Redis: " + out.error);
  return out.result;
}

// Varios comandos en un viaje
export async function pipeline(cmds) {
  if (!cmds.length) return [];
  const out = await call("/pipeline", cmds.map((c) => c.map(String)));
  return out.map((x) => { if (x.error) throw new Error("Redis: " + x.error); return x.result; });
}

// HGETALL devuelve [k1, v1, k2, v2...]: lo pasamos a objeto
export const toObj = (arr) => {
  if (!arr || !arr.length) return null;
  const o = {};
  for (let i = 0; i < arr.length; i += 2) o[arr[i]] = arr[i + 1];
  return o;
};

export const hgetall = async (key) => toObj(await redis("HGETALL", key));
export const hset = (key, obj) => {
  const flat = Object.entries(obj).filter(([, v]) => v !== undefined && v !== null).flatMap(([k, v]) => [k, typeof v === "object" ? JSON.stringify(v) : v]);
  return flat.length ? redis("HSET", key, ...flat) : 0;
};

// true solo la primera vez para esa clave (sirve para "una sola vez por pago")
export const once = async (key, ttlSeconds) =>
  (await redis(...["SET", key, Date.now(), "NX", ...(ttlSeconds ? ["EX", ttlSeconds] : [])])) === "OK";

// Límite de intentos: true si todavía está dentro del límite
export async function rateLimit(key, max, windowSeconds) {
  const [n] = await pipeline([["INCR", key], ["EXPIRE", key, windowSeconds, "NX"]]);
  return n <= max;
}
