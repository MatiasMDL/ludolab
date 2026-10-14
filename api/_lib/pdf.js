import { issueSignedToken, presignUrl, head } from "@vercel/blob";

// Los PDFs viven en un Blob PRIVADO (variable EBOOKS_READ_WRITE_TOKEN). No hay URL pública:
// cada vez que un comprador abre su ebook generamos un link firmado que vence a los 10 minutos.
export const privateToken = () => process.env.EBOOKS_READ_WRITE_TOKEN;

export async function signedPdfUrl(pathname, minutes = 10) {
  const token = privateToken();
  if (!token) throw new Error("Falta EBOOKS_READ_WRITE_TOKEN (Blob privado de los PDFs)");
  const validUntil = Date.now() + minutes * 60e3;
  const st = await issueSignedToken({ token, pathname, operations: ["get"], validUntil });
  const { presignedUrl } = await presignUrl(st, { operation: "get", pathname, access: "private", validUntil });
  return presignedUrl;
}

export async function privatePdfExists(pathname) {
  const token = privateToken();
  if (!token) return false;
  try { await head(pathname, { token }); return true; } catch { return false; }
}
