import crypto from "node:crypto";

export const env = (k, fallback) => {
  const v = process.env[k];
  if (v === undefined || v === "") {
    if (fallback !== undefined) return fallback;
    throw new Error(`Falta la variable de entorno ${k}`);
  }
  return v;
};

export const SITE = () => env("SITE_URL", "https://ludolab.app").replace(/\/$/, "");
export const sha = (s) => crypto.createHash("sha256").update(String(s).trim().toLowerCase()).digest("hex");
export const hmac = (s) => crypto.createHmac("sha256", env("DOWNLOAD_SECRET")).update(s).digest("base64url");
export const randomToken = (bytes = 24) => crypto.randomBytes(bytes).toString("base64url");
export const clean = (o) => Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined && v !== null && v !== "" && !(Array.isArray(v) && !v.length)));
export const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
export const horaAR = (d) => new Date(d || Date.now()).toLocaleString("es-AR", { timeZone: "America/Argentina/Buenos_Aires", dateStyle: "short", timeStyle: "short" });
export const diaAR = (d) => new Date(d || Date.now()).toLocaleDateString("en-CA", { timeZone: "America/Argentina/Buenos_Aires" });
export const clientIp = (req) => String(req.headers["x-forwarded-for"] || req.headers["x-real-ip"] || "").split(",")[0].trim();
export const body = (req) => (typeof req.body === "string" ? JSON.parse(req.body || "{}") : req.body || {});

export const EMAIL_RE = /^[^\s@|]+@[^\s@|]+\.[a-z]{2,}$/i;
export const normEmail = (e) => String(e || "").trim().toLowerCase();
export const validEmail = (e) => EMAIL_RE.test(e) && e.length <= 120;

// "an***@gmail.com" para mostrar en pantalla sin exponer el mail completo
export const maskEmail = (e = "") => {
  const [u, d] = String(e).split("@");
  if (!d) return "";
  return (u.length <= 2 ? u[0] + "*" : u.slice(0, 2) + "***") + "@" + d;
};

export const safeEqual = (a, b) => {
  const x = Buffer.from(String(a)), y = Buffer.from(String(b));
  return x.length === y.length && crypto.timingSafeEqual(x, y);
};
