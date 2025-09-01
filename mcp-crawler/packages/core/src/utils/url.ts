// packages/core/src/utils/url.ts
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import normalizeUrl, { type Options as NormalizeOptions } from "normalize-url";

/**
 * Permite sobreescribir la ruta del archivo de extensiones por ENV (opcional):
 *   CRAWLER_IGNORE_EXT_FILE=/ruta/absoluta/a/ignore-extensions.txt
 *
 * Si no se define, carga el asset empaquetado en:
 *   packages/core/assets/ignore-extensions.txt
 */
function resolveIgnoreListPath(): string {
  const override = process.env.CRAWLER_IGNORE_EXT_FILE;
  if (override && fs.existsSync(override)) return override;

  // Ruta al asset relativo a este archivo (ESM friendly)
  const here = fileURLToPath(new URL(".", import.meta.url));
  const asset = path.resolve(here, "../../assets/ignore-extensions.txt");
  return asset;
}

let ignoredExt: string[] = [];
(() => {
  try {
    const file = resolveIgnoreListPath();
    if (fs.existsSync(file)) {
      ignoredExt = fs
        .readFileSync(file, "utf8")
        .split("\n")
        .map((s) => s.trim().toLowerCase())
        .filter(Boolean);
    } else {
      ignoredExt = [];
    }
  } catch {
    ignoredExt = [];
  }
})();

/** Parámetros típicos de tracking que conviene limpiar para la clave canónica */
const TRACKING_PARAMS = new Set([
  "utm_source",
  "utm_medium",
  "utm_campaign",
  "utm_term",
  "utm_content",
  "gclid",
  "fbclid",
  "igshid",
  "mc_cid",
  "mc_eid",
]);

export function stripTrackingParams(u: URL) {
  for (const p of [...u.searchParams.keys()]) {
    if (TRACKING_PARAMS.has(p)) u.searchParams.delete(p);
  }
}

/**
 * Opciones de normalize-url:
 * - removeDirectoryIndex: true   → quita index.html, index.php, etc.
 * - sortQueryParameters: true    → ordena querystring estable
 * - removeTrailingSlash: true    → quita slash final seguro
 * - stripWWW: false              → mantenemos www (no siempre deseable quitarlo)
 * - forceHttp/forceHttps: false  → no forzamos protocolo
 *
 * Nota: NO usar stripFragment (no existe en los tipos de esta versión).
 */
const NORMALIZE_OPTS: NormalizeOptions = {
  removeDirectoryIndex: true,
  sortQueryParameters: true,
  removeTrailingSlash: true,
  stripWWW: false,
  forceHttp: false,
  forceHttps: false,
};

export function normalizeForKey(urlStr: string): string {
  let u: URL;
  try {
    u = new URL(urlStr);
  } catch {
    // Si no es URL válida, devuelve como vino (clave "tal cual")
    return urlStr;
  }

  // Normalizaciones manuales seguras previas a normalize-url
  u.host = u.host.toLowerCase();
  u.hash = ""; // elimina fragmento (#...)
  stripTrackingParams(u);

  // Normaliza con opciones conocidas/compatibles
  const normalized = normalizeUrl(u.toString(), NORMALIZE_OPTS);

  // Asegura host en minúsculas tras normalize
  const u2 = new URL(normalized);
  u2.host = u2.host.toLowerCase();
  return u2.toString();
}

/**
 * ¡OJO! Implementación simple de eTLD+1 (últimas dos etiquetas).
 * No maneja correctamente TLDs compuestos (co.uk, com.ar, etc.).
 * Si necesitas precisión, podemos migrar a 'psl' para public suffix.
 */
export function sameETLD1(a: URL, b: URL): boolean {
  const aParts = a.hostname.toLowerCase().split(".");
  const bParts = b.hostname.toLowerCase().split(".");
  const aKey = aParts.slice(-2).join(".");
  const bKey = bParts.slice(-2).join(".");
  return aKey === bKey;
}

export function isInternal(base: URL, target: URL, includeSubdomains = false): boolean {
  if (!sameETLD1(base, target)) return false;
  if (!includeSubdomains) return base.hostname.toLowerCase() === target.hostname.toLowerCase();
  return true;
}

/**
 * Devuelve true si la URL tiene una extensión que debemos ignorar
 * según la lista cargada desde assets/ignore-extensions.txt.
 *
 * - Compara por extensión "simple" (path.extname).
 * - También intenta con la variante sin punto (".pdf" → "pdf").
 * - Para multipart (tar.gz), la lista contiene entradas específicas.
 */
export function hasIgnoredExtension(u: URL): boolean {
  const pathname = u.pathname.toLowerCase();

  // 1) Coincidencias exactas multipart comunes (tar.gz, tar.bz2, tar.xz)
  if (
    pathname.endsWith(".tar.gz") ||
    pathname.endsWith(".tar.bz2") ||
    pathname.endsWith(".tar.xz")
  ) {
    // Solo si están en la lista
    if (ignoredExt.includes("tar.gz")) return true;
    if (ignoredExt.includes("tar.bz2")) return true;
    if (ignoredExt.includes("tar.xz")) return true;
  }

  // 2) Extensión simple
  const ext = path.extname(pathname); // incluye el punto, p. ej. ".pdf"
  if (!ext) return false;

  const withoutDot = ext.startsWith(".") ? ext.slice(1) : ext;

  // Normalizamos la lista a equivalencias "pdf" y ".pdf"
  return ignoredExt.includes(withoutDot) || ignoredExt.includes(ext);
}

/** Convierte href relativo a absoluto según base; devuelve null si falla */
export function absolutize(base: URL, href: string): string | null {
  try {
    return new URL(href, base).toString();
  } catch {
    return null;
  }
}
