// packages/core/src/utils/sitemap.ts
import { XMLParser } from "fast-xml-parser";

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: "",
});

type SitemapItem = { loc?: string | null };
type SitemapIndex =
  | { sitemapindex?: { sitemap: SitemapItem[] } }
  | { sitemapindex?: { sitemap: SitemapItem } }
  | Record<string, unknown>;

type UrlItem = { loc?: string | null };
type UrlSet =
  | { urlset?: { url: UrlItem[] } }
  | { urlset?: { url: UrlItem } }
  | Record<string, unknown>;

type SitemapDoc = SitemapIndex & UrlSet;

async function fetchText(url: string, ua: string): Promise<string> {
  const res = await fetch(url, { headers: { "User-Agent": ua } });
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
  return res.text();
}

/**
 * Combina sitemaps declarados en robots.txt con una conjetura estándar /sitemap.xml.
 * Devuelve endpoints de sitemap (no las URLs contenidas).
 */
export async function discoverSitemaps(
  startUrl: string,
  robotsSitemaps: string[] = [],
  _userAgent: string
): Promise<string[]> {
  const found = new Set<string>(robotsSitemaps);
  try {
    const u = new URL(startUrl);
    const guess = new URL("/sitemap.xml", `${u.protocol}//${u.host}`).toString();
    found.add(guess);
  } catch {
    // URL inválida: devolvemos lo que haya
  }
  return [...found];
}

/**
 * Recoge URLs de un sitemap endpoint (acepta sitemap index o urlset).
 * Limita el total con `limit` para evitar explotar el crawler.
 */
export async function collectSitemapUrls(
  sitemapUrl: string,
  userAgent: string,
  limit = 2000
): Promise<string[]> {
  try {
    const xml = await fetchText(sitemapUrl, userAgent);
    const doc = parser.parse(xml) as SitemapDoc;

    // ¿Es un índice de sitemaps?
    const si = (doc as any).sitemapindex?.sitemap;
    if (si) {
      const children: SitemapItem[] = Array.isArray(si) ? si : [si];
      const acc: string[] = [];
      for (const child of children) {
        if (!child?.loc) continue;
        const childUrls = await collectSitemapUrls(child.loc, userAgent, limit - acc.length);
        for (const cu of childUrls) {
          acc.push(cu);
          if (acc.length >= limit) break;
        }
        if (acc.length >= limit) break;
      }
      return acc;
    }

    // ¿Es un urlset?
    const us = (doc as any).urlset?.url;
    if (us) {
      const entries: UrlItem[] = Array.isArray(us) ? us : [us];
      const urls = entries
        .map((e) => (e?.loc ?? "").toString().trim())
        .filter(Boolean)
        .slice(0, limit);
      return urls;
    }
  } catch {
    // sitemap inaccesible o malformado: devolver vacío
  }
  return [];
}
