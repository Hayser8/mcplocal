// packages/core/src/crawler/crawl.ts
import pLimit from "p-limit";
import * as cheerio from "cheerio";
import { setTimeout as wait } from "node:timers/promises";
import {
  type CrawlInput,
  type CrawlOutput,
  type InventoryItem,
  type Edge,
  type RedirectHop,
} from "../types/contracts.js";
import {
  normalizeForKey,
  isInternal,
  hasIgnoredExtension,
  absolutize,
} from "../utils/url.js";
import { getRobotsAgent } from "../utils/robots.js";
import type { Element } from "domhandler";
import { discoverSitemaps, collectSitemapUrls } from "../utils/sitemap.js";

/** UA de navegador por defecto para evitar bloqueos por WAF/anti-bot */
const BROWSER_UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124 Safari/537.36";

const DEFAULTS = {
  depth: Number(process.env.CRAWLER_DEFAULT_DEPTH ?? 2),
  maxPages: Number(process.env.CRAWLER_MAX_PAGES ?? 500),
  ua: (process.env.CRAWLER_USER_AGENT?.trim() || BROWSER_UA),
  maxConcurrency: Number(process.env.CRAWLER_MAX_CONCURRENCY ?? 6),
  respectRobots: process.env.CRAWLER_RESPECT_ROBOTS === "1",
  requestTimeoutMs: Number(process.env.CRAWLER_TIMEOUT_MS ?? 20000),
};

/** AbortController con timeout */
function abortSignal(ms: number) {
  const c = new AbortController();
  const t = setTimeout(() => c.abort(), ms);
  // @ts-ignore
  t.unref?.();
  return c.signal;
}

/** Estados típicos de bloqueo por WAF/CDN */
const BLOCKED_STATUSES = new Set([403, 406, 409, 410, 429, 451, 503]);

/** Un solo fetch con headers “de navegador” y timeout */
async function fetchOnce(url: string, ua: string, timeoutMs: number) {
  return fetch(url, {
    headers: {
      "User-Agent": ua,
      accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
      "accept-language": "en-US,en;q=0.9,es;q=0.8",
    },
    redirect: "manual",
    signal: abortSignal(timeoutMs),
  });
}

/**
 * Fetch + seguimiento de redirects.
 * Si el UA inicial recibe un status de bloqueo, reintenta 1 vez con BROWSER_UA.
 */
async function fetchWithRedirects(url: string, ua: string, timeoutMs: number) {
  const chain = async (initialUrl: string, useUA: string) => {
    const hops: RedirectHop[] = [];
    let currentUrl = initialUrl;
    let safety = 10;

    let res = await fetchOnce(currentUrl, useUA, timeoutMs);

    while ([301, 302, 303, 307, 308].includes(res.status) && safety-- > 0) {
      const loc = res.headers.get("location");
      if (!loc) break;
      const next = new URL(loc, currentUrl).toString();
      hops.push({ from: currentUrl, to: next, status: res.status });
      currentUrl = next;
      res = await fetchOnce(currentUrl, useUA, timeoutMs);
    }
    return { res, finalUrl: currentUrl, redirectChain: hops };
  };

  // Primer intento con el UA solicitado
  try {
    const r1 = await chain(url, ua);
    if (BLOCKED_STATUSES.has(r1.res.status) && ua !== BROWSER_UA) {
      // Reintento con UA de navegador
      try {
        return await chain(url, BROWSER_UA);
      } catch {
        return r1;
      }
    }
    return r1;
  } catch {
    // Si falla duro (timeout/red), prueba directamente con UA de navegador
    if (ua !== BROWSER_UA) return chain(url, BROWSER_UA);
    throw new Error("fetch failed");
  }
}

export async function crawlSite(input: CrawlInput): Promise<CrawlOutput> {
  const start = Date.now();
  const depthMax = input.depth ?? DEFAULTS.depth;
  const maxPages = input.maxPages ?? DEFAULTS.maxPages;
  const includeSub = Boolean(input.includeSubdomains);
  const ua = (input.userAgent?.trim() || DEFAULTS.ua) || BROWSER_UA;

  const base = new URL(input.startUrl);
  const origin = `${base.protocol}//${base.host}`;

  const robots = DEFAULTS.respectRobots
    ? await getRobotsAgent(origin, ua)
    : { isAllowed: () => true, sitemaps: [] as string[] };

  // --- Descubrimiento de sitemaps (semillas) ---
  const smCandidatesSet = new Set<string>(
    await discoverSitemaps(input.startUrl, robots.sitemaps ?? [], ua)
  );

  // Asegurar candidatos /sitemap.xml para www y no-www
  const host = base.hostname;
  const rootSm = new URL("/sitemap.xml", base).href;
  smCandidatesSet.add(rootSm);
  if (host.startsWith("www.")) {
    smCandidatesSet.add(`${base.protocol}//${host.replace(/^www\./, "")}/sitemap.xml`);
  } else {
    smCandidatesSet.add(`${base.protocol}//www.${host}/sitemap.xml`);
  }
  const smCandidates = [...smCandidatesSet];

  const fromSitemaps = new Set<string>();
  for (const sm of smCandidates) {
    try {
      const urls = await collectSitemapUrls(sm, ua, maxPages);
      for (const u of urls) fromSitemaps.add(normalizeForKey(u));
    } catch {
      // si un sitemap falla, seguimos con los demás
    }
  }

  // --- BFS HTML: sembramos home + variante www/no-www
  const queue: Array<{ url: string; depth: number }> = [
    { url: base.toString(), depth: 0 },
  ];
  if (host.startsWith("www.")) {
    queue.push({ url: `${base.protocol}//${host.replace(/^www\./, "")}${base.pathname}`, depth: 0 });
  } else {
    queue.push({ url: `${base.protocol}//www.${host}${base.pathname}`, depth: 0 });
  }

  const seen = new Set<string>();
  const inventoryMap = new Map<string, InventoryItem>();
  const edges: Edge[] = [];

  const limit = pLimit(DEFAULTS.maxConcurrency);
  let fetchedCount = 0;

  async function visit(node: { url: string; depth: number }) {
    if (fetchedCount >= maxPages) return;
    const key = normalizeForKey(node.url);
    if (seen.has(key)) return;
    seen.add(key);

    let u: URL;
    try {
      u = new URL(node.url);
    } catch {
      return;
    }
    if (!isInternal(base, u, includeSub)) return;
    if (hasIgnoredExtension(u)) return;
    if (DEFAULTS.respectRobots && !robots.isAllowed(node.url)) return;

    // Fetch + redirects con timeout y fallback de UA
    let resInfo: { res: Response; finalUrl: string; redirectChain: RedirectHop[] };
    try {
      resInfo = await fetchWithRedirects(node.url, ua, DEFAULTS.requestTimeoutMs);
    } catch {
      return;
    }

    const { res, finalUrl, redirectChain } = resInfo;
    fetchedCount++;

    const contentType = res.headers.get("content-type") || null;

    // discoveredBy: chequea key y finalUrl normalizado
    const inSm = fromSitemaps.has(key) || fromSitemaps.has(normalizeForKey(finalUrl));

    const item: InventoryItem = {
      url: node.url,
      normalizedUrl: key,
      finalUrl,
      status: res.status,
      contentType,
      depth: node.depth,
      discoveredBy: inSm ? "both" : "html",
      redirectChain,
    };

    if (inventoryMap.has(key)) {
      const prev = inventoryMap.get(key)!;
      const merged: InventoryItem = {
        ...prev,
        ...item,
        discoveredBy:
          prev.discoveredBy === "sitemap" || item.discoveredBy === "both"
            ? "both"
            : item.discoveredBy,
      };
      inventoryMap.set(key, merged);
    } else {
      inventoryMap.set(key, item);
    }

    // Parsear HTML para edges; encolar si hay profundidad disponible
    if (res.ok && contentType?.includes("text/html")) {
      let html = "";
      try { html = await res.text(); } catch {}
      if (html) {
        const $ = cheerio.load(html);
        const hrefs = new Set<string>();
        $("a[href]").each((_i: number, el: Element) => {
          const raw = String($(el).attr("href") ?? "").trim();
          if (!raw) return;
          const abs = absolutize(new URL(finalUrl), raw);
          if (abs) hrefs.add(abs);
        });

        for (const toAbs of hrefs) {
          try {
            const toURL = new URL(toAbs);
            if (!isInternal(base, toURL, includeSub)) continue;
            if (hasIgnoredExtension(toURL)) continue;
            const toKey = normalizeForKey(toAbs);
            edges.push({ from: normalizeForKey(finalUrl), to: toKey });
            if (!seen.has(toKey) && node.depth < depthMax) {
              queue.push({ url: toAbs, depth: node.depth + 1 });
            }
          } catch {}
        }
      }
    }

    if ("crawlDelay" in robots && (robots as any).crawlDelay) {
      const s = Number((robots as any).crawlDelay) || 0;
      if (s > 0) await wait(s * 1000);
    }
  }

  // Marca URLs del sitemap en el inventario (sin fetch)
  for (const k of fromSitemaps) {
    if (!inventoryMap.has(k)) {
      inventoryMap.set(k, {
        url: k,
        normalizedUrl: k,
        finalUrl: k,
        status: 0,
        contentType: null,
        depth: 9999,
        discoveredBy: "sitemap",
        redirectChain: [],
      });
    } else {
      const prev = inventoryMap.get(k)!;
      inventoryMap.set(k, {
        ...prev,
        discoveredBy: prev.discoveredBy === "html" ? "both" : "sitemap",
      });
    }
  }

  // Ejecuta BFS con concurrencia
  while (queue.length && fetchedCount < maxPages) {
    const batch = queue.splice(0, DEFAULTS.maxConcurrency);
    await Promise.all(batch.map((node) => limit(() => visit(node))));
  }

  // Post-pass: fetch de URLs del sitemap con inbound y sin status aún
  const inbound = new Set<string>();
  for (const e of edges) inbound.add(e.to);

  const candidates = [...fromSitemaps].filter((k) => {
    const it = inventoryMap.get(k);
    return inbound.has(k) && it && it.status === 0;
  });

  const room = Math.max(0, maxPages - fetchedCount);
  const toFetch = candidates.slice(0, room);

  await Promise.all(
    toFetch.map(async (k) => {
      try {
        const { res, finalUrl, redirectChain } = await fetchWithRedirects(
          k,
          ua,
          DEFAULTS.requestTimeoutMs
        );
        const contentType = res.headers.get("content-type") || null;
        const prev = inventoryMap.get(k)!;
        inventoryMap.set(k, {
          ...prev,
          finalUrl,
          status: res.status,
          contentType,
          depth: Math.min(prev.depth, depthMax + 1),
          discoveredBy: "both",
          redirectChain,
        });
        fetchedCount++;
      } catch {
        // mantener estado previo si falla
      }
    })
  );

  // Reportes derivados (SEO)
  const sitemapSet = new Set<string>(fromSitemaps);
  const inventory = [...inventoryMap.values()];

  const orphansInSitemap = [...sitemapSet].filter((k) => !inbound.has(k));
  const linkedNotInSitemap = [...inbound].filter((k) => !sitemapSet.has(k));

  const statusBuckets = inventory.reduce(
    (acc, i) => {
      if (i.status === 0) acc["0xx"]++;
      else if (i.status >= 200 && i.status < 300) acc["2xx"]++;
      else if (i.status >= 300 && i.status < 400) acc["3xx"]++;
      else if (i.status >= 400 && i.status < 500) acc["4xx"]++;
      else if (i.status >= 500 && i.status < 600) acc["5xx"]++;
      return acc;
    },
    { "0xx": 0, "2xx": 0, "3xx": 0, "4xx": 0, "5xx": 0 }
  );

  const end = Date.now();

  return {
    inventory,
    edges,
    sitemap: smCandidates,
    stats: {
      pagesFetched: fetchedCount,
      pagesFromSitemap: fromSitemaps.size,
      pagesFromHtml: inventory.filter(
        (i) => i.discoveredBy === "html" || i.discoveredBy === "both"
      ).length,
      elapsedMs: end - start,
    },
    reports: {
      orphansInSitemap,
      linkedNotInSitemap,
      statusBuckets,
    },
  };
}
