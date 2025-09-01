// packages/core/src/audit/indexability.ts
import * as cheerio from "cheerio";
import pLimit from "p-limit";
import { setTimeout as wait } from "node:timers/promises";
import {
  type AuditInput,
  type AuditOutput,
  type AuditResult,
  type RobotsDirectives,
  type HreflangLink,
  type RedirectHop,
} from "../types/contracts";
import { absolutize, sameETLD1 } from "../utils/url";

const DEFAULT_UA = process.env.CRAWLER_USER_AGENT ?? "mcp-crawler";
const MAX_CONCURRENCY = Number(process.env.CRAWLER_MAX_CONCURRENCY ?? 6);

/** Sigue redirecciones manualmente y devuelve la respuesta final + cadena de hops */
async function fetchWithRedirects(url: string, ua: string) {
  const hops: RedirectHop[] = [];
  const init: RequestInit = { headers: { "User-Agent": ua }, redirect: "manual" };
  let res = await fetch(url, init);
  let currentUrl = url;
  let safety = 10;

  while ([301, 302, 303, 307, 308].includes(res.status) && safety-- > 0) {
    const loc = res.headers.get("location");
    if (!loc) break;
    const next = new URL(loc, currentUrl).toString();
    hops.push({ from: currentUrl, to: next, status: res.status });
    currentUrl = next;
    res = await fetch(currentUrl, init);
  }
  return { res, finalUrl: currentUrl, redirectChain: hops };
}

/** Parse de directivas robots (meta o header) en forma booleana */
function parseRobotsDirectives(raw: string | null | undefined): RobotsDirectives | undefined {
  if (!raw) return undefined;
  // Puede venir con múltiples encabezados separados; unifícalo a coma
  const tokens = raw
    .split(/[,;]+/g)
    .map((t) => t.trim().toLowerCase())
    .filter(Boolean);

  // Si aparece "all", asumimos index,follow (sin no-*)
  const out: RobotsDirectives = {};
  for (const t of tokens) {
    if (t === "noindex") out.noindex = true;
    else if (t === "nofollow") out.nofollow = true;
    else if (t === "noarchive") out.noarchive = true;
    else if (t === "nosnippet") out.nosnippet = true;
    else if (t === "noimageindex") out.noimageindex = true;
    else if (t === "nocache") out.nocache = true;
    // ignoramos max-snippet, max-image-preview, etc. en este MVP
  }
  // Si no se marcó nada, devolvemos objeto vacío (puede haber sido "all" o irrelevante)
  return Object.keys(out).length ? out : {};
}

function mergeRobots(a?: RobotsDirectives, b?: RobotsDirectives): RobotsDirectives | undefined {
  if (!a && !b) return undefined;
  return {
    noindex: Boolean(a?.noindex || b?.noindex),
    nofollow: Boolean(a?.nofollow || b?.nofollow),
    noarchive: Boolean(a?.noarchive || b?.noarchive),
    nosnippet: Boolean(a?.nosnippet || b?.nosnippet),
    noimageindex: Boolean(a?.noimageindex || b?.noimageindex),
    nocache: Boolean(a?.nocache || b?.nocache),
  };
}

/** Obtiene todos los valores de X-Robots-Tag (puede venir varias veces) */
function getAllXRobots(headers: Headers): string[] {
  const vals: string[] = [];
  headers.forEach((value, key) => {
    if (key.toLowerCase() === "x-robots-tag") vals.push(value);
  });
  return vals;
}

/** Extrae canonical absoluto y hreflang[] del HTML */
function extractHtmlSignals(html: string, baseUrl: string): {
  canonical?: string | null;
  hreflang: HreflangLink[];
  metaRobots?: RobotsDirectives;
  issues: string[];
} {
  const $ = cheerio.load(html);
  const issues: string[] = [];

  // Canonical
  const canonEls = $('link[rel="canonical"]');
  let canonical: string | null | undefined = undefined;
  if (canonEls.length > 1) issues.push("multiple canonicals");
  if (canonEls.length >= 1) {
    const href = String($(canonEls[0]).attr("href") ?? "").trim();
    if (href) {
      const abs = absolutize(new URL(baseUrl), href);
      canonical = abs ?? null;
    } else {
      canonical = null;
    }
  }

  // hreflang alternates
  const hreflang: HreflangLink[] = [];
  $('link[rel="alternate"][hreflang]').each((_, el) => {
    const lang = String($(el).attr("hreflang") ?? "").trim();
    const href = String($(el).attr("href") ?? "").trim();
    if (!lang || !href) return;
    const abs = absolutize(new URL(baseUrl), href);
    if (abs) hreflang.push({ lang, href: abs });
  });

  // meta robots
  let metaRobots: RobotsDirectives | undefined;
  const metas = $('meta[name="robots"], meta[name="ROBOTS"]');
  if (metas.length > 0) {
    // si hay varias, mergeamos
    metas.each((_, el) => {
      const content = String($(el).attr("content") ?? "");
      const parsed = parseRobotsDirectives(content);
      metaRobots = mergeRobots(metaRobots, parsed);
    });
  }

  return { canonical, hreflang, metaRobots, issues };
}

export async function auditIndexability(input: AuditInput): Promise<AuditOutput> {
  const ua = input.userAgent ?? DEFAULT_UA;
  const limit = pLimit(MAX_CONCURRENCY);

  const tasks = input.urls.map((rawUrl) =>
    limit(async (): Promise<AuditResult> => {
      // Fetch final con redirects
      let resInfo: { res: Response; finalUrl: string; redirectChain: RedirectHop[] };
      try {
        resInfo = await fetchWithRedirects(rawUrl, ua);
      } catch {
        // Caso extremo: no se pudo obtener nada
        return {
          url: rawUrl,
          finalUrl: rawUrl,
          status: 0,
          contentType: null,
          canonical: null,
          metaRobots: undefined,
          xRobots: undefined,
          noindex: { meta: false, header: false },
          hreflang: [],
          issues: ["fetch failed"],
          redirectChain: [],
        };
      }

      const { res, finalUrl, redirectChain } = resInfo;
      const status = res.status;
      const contentType = res.headers.get("content-type");

      // X-Robots-Tag (puede haber varios)
      const xValues = getAllXRobots(res.headers);
      let xRobots: RobotsDirectives | undefined;
      for (const v of xValues) {
        const parsed = parseRobotsDirectives(v);
        xRobots = mergeRobots(xRobots, parsed);
      }

      let canonical: string | null | undefined = undefined;
      let hreflang: HreflangLink[] = [];
      let metaRobots: RobotsDirectives | undefined;
      const issues: string[] = [];

      // Si es HTML, parseamos el documento para signals
      if (status !== 204 && contentType?.includes("text/html")) {
        let html = "";
        try {
          html = await res.text();
        } catch {
          // ignore
        }
        if (html) {
          const extracted = extractHtmlSignals(html, finalUrl);
          canonical = extracted.canonical;
          hreflang = extracted.hreflang;
          metaRobots = extracted.metaRobots;
          issues.push(...extracted.issues);
        }
      }

      // Flags de noindex
      const noindexMeta = Boolean(metaRobots?.noindex);
      const noindexHeader = Boolean(xRobots?.noindex);

      // Conflictos comunes
      if (noindexMeta !== noindexHeader && (noindexMeta || noindexHeader)) {
        issues.push("conflicting noindex between meta and header");
      }

      // Canonical off-domain
      try {
        if (canonical) {
          const pageU = new URL(finalUrl);
          const canonU = new URL(canonical);
          if (!sameETLD1(pageU, canonU)) issues.push("canonical points to different eTLD+1");
        }
      } catch {
        // canonical mal formado
        issues.push("invalid canonical URL");
      }

      return {
        url: rawUrl,
        finalUrl,
        status,
        contentType,
        canonical: canonical ?? null,
        metaRobots,
        xRobots,
        noindex: { meta: noindexMeta, header: noindexHeader },
        hreflang,
        issues,
        redirectChain,
      };
    })
  );

  const results = await Promise.all(tasks);
  // Respiro ligero para evitar bloquear el event loop si fueron muchas
  if (results.length > 20) await wait(0);
  return { results };
}
