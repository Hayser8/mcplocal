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
} from "../types/contracts";
import {
  normalizeForKey,
  isInternal,
  hasIgnoredExtension,
  absolutize,
} from "../utils/url";
import { getRobotsAgent } from "../utils/robots";
import { discoverSitemaps, collectSitemapUrls } from "../utils/sitemap";

const DEFAULTS = {
  depth: Number(process.env.CRAWLER_DEFAULT_DEPTH ?? 2),
  maxPages: Number(process.env.CRAWLER_MAX_PAGES ?? 500),
  ua: process.env.CRAWLER_USER_AGENT ?? "mcp-crawler",
  maxConcurrency: Number(process.env.CRAWLER_MAX_CONCURRENCY ?? 6),
  respectRobots: process.env.CRAWLER_RESPECT_ROBOTS === "1",
};

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

export async function crawlSite(input: CrawlInput): Promise<CrawlOutput> {
  const start = Date.now();
  const depthMax = input.depth ?? DEFAULTS.depth;
  const maxPages = input.maxPages ?? DEFAULTS.maxPages;
  const includeSub = Boolean(input.includeSubdomains);
  const ua = input.userAgent ?? DEFAULTS.ua;

  const base = new URL(input.startUrl);
  const origin = `${base.protocol}//${base.host}`;

  const robots = DEFAULTS.respectRobots
    ? await getRobotsAgent(origin, ua)
    : { isAllowed: () => true, sitemaps: [] as string[] };

  // Sitemaps → seeds normalizados
  const smCandidates = await discoverSitemaps(input.startUrl, robots.sitemaps ?? [], ua);
  const fromSitemaps = new Set<string>();
  for (const sm of smCandidates) {
    const urls = await collectSitemapUrls(sm, ua, maxPages);
    for (const u of urls) fromSitemaps.add(normalizeForKey(u));
  }

  // BFS HTML
  const queue: Array<{ url: string; depth: number }> = [{ url: base.toString(), depth: 0 }];
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

    const u = new URL(node.url);
    if (!isInternal(base, u, includeSub)) return;
    if (hasIgnoredExtension(u)) return;
    if (DEFAULTS.respectRobots && !robots.isAllowed(node.url)) return;

    // Fetch + redirects
    let resInfo: { res: Response; finalUrl: string; redirectChain: RedirectHop[] };
    try {
      resInfo = await fetchWithRedirects(node.url, ua);
    } catch {
      return;
    }

    const { res, finalUrl, redirectChain } = resInfo;
    fetchedCount++;

    const contentType = res.headers.get("content-type");
    const item: InventoryItem = {
      url: node.url,
      normalizedUrl: key,
      finalUrl,
      status: res.status,
      contentType,
      depth: node.depth,
      discoveredBy: fromSitemaps.has(key) ? "both" : "html",
      redirectChain,
    };

    if (inventoryMap.has(key)) {
      const prev = inventoryMap.get(key)!;
      const merged: InventoryItem = {
        ...prev,
        ...item,
        discoveredBy: prev.discoveredBy === "sitemap" ? "both" : item.discoveredBy,
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
        $("a[href]").each((_, el) => {
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
            edges.push({ from: finalUrl, to: toKey });
            if (!seen.has(toKey) && node.depth < depthMax) {
              queue.push({ url: toAbs, depth: node.depth + 1 });
            }
          } catch {}
        }
      }
    }

    if ("crawlDelay" in robots && (robots as any).crawlDelay) {
      await wait((robots as any).crawlDelay * 1000);
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
      inventoryMap.set(k, { ...prev, discoveredBy: prev.discoveredBy === "html" ? "both" : "sitemap" });
    }
  }

  // Ejecuta BFS con concurrencia
  while (queue.length && fetchedCount < maxPages) {
    const batch = queue.splice(0, DEFAULTS.maxConcurrency);
    await Promise.all(batch.map((node) => limit(() => visit(node))));
  }

  // Post-pass: fetch de candidatos del sitemap con inbound no resueltos
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
        const { res, finalUrl, redirectChain } = await fetchWithRedirects(k, ua);
        const contentType = res.headers.get("content-type");
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
      pagesFromHtml: inventory.filter((i) => i.discoveredBy === "html" || i.discoveredBy === "both").length,
      elapsedMs: end - start,
    },
    reports: {
      orphansInSitemap,
      linkedNotInSitemap,
      statusBuckets,
    },
  };
}
