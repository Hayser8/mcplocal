// ---------------------------
// CRAWL TYPES
// ---------------------------
export type DiscoveredBy = "html" | "sitemap" | "both";

export interface CrawlInput {
  startUrl: string;
  depth?: number;            // default: 2
  maxPages?: number;         // default: 500
  includeSubdomains?: boolean;
  userAgent?: string;        // default: env CRAWLER_USER_AGENT
}

export interface RedirectHop { from: string; to: string; status: number; }

export interface InventoryItem {
  url: string;               // URL original solicitada
  normalizedUrl: string;     // URL normalizada (clave única)
  finalUrl: string;          // URL final después de redirects
  status: number;            // HTTP status code
  contentType?: string | null;
  depth: number;             // distancia desde startUrl (HTML BFS)
  discoveredBy: DiscoveredBy;
  redirectChain: RedirectHop[];
}

export interface Edge { from: string; to: string; } // enlaces internos (HTML)

export interface CrawlReports {
  /** En sitemap pero NO enlazadas internamente (descubiertas solo por sitemap) */
  orphansInSitemap: string[];
  /** Enlazadas internamente pero NO listadas en sitemap (descubiertas solo por HTML) */
  linkedNotInSitemap: string[];
  /** Conteo por familia de status (2xx, 3xx, 4xx, 5xx, 0=sin fetch) */
  statusBuckets: {
    "0xx": number;
    "2xx": number;
    "3xx": number;
    "4xx": number;
    "5xx": number;
  };
}

export interface CrawlOutput {
  inventory: InventoryItem[];
  edges: Edge[];
  /** Endpoints de sitemap (no las URLs que contienen) */
  sitemap: string[];
  stats: {
    pagesFetched: number;
    pagesFromSitemap: number;
    pagesFromHtml: number;
    elapsedMs: number;
  };
  /** Reportes derivados para SEO */
  reports: CrawlReports;
}

// ---------------------------
// AUDIT / INDEXABILITY TYPES
// ---------------------------
export interface AuditInput {
  urls: string[];
  userAgent?: string;        // default: env CRAWLER_USER_AGENT
}

export interface RobotsDirectives {
  noindex?: boolean;
  nofollow?: boolean;
  noarchive?: boolean;
  nosnippet?: boolean;
  noimageindex?: boolean;
  nocache?: boolean;
}

export interface HreflangLink {
  lang: string;              // ej. "es", "es-GT", "x-default"
  href: string;              // URL absoluta
}

export interface AuditResult {
  url: string;               // URL solicitada
  finalUrl: string;          // después de redirects
  status: number;
  contentType?: string | null;

  // Canonical absoluto (si existe y es parseable)
  canonical?: string | null;

  // Meta robots y X-Robots-Tag (cabecera)
  metaRobots?: RobotsDirectives;
  xRobots?: RobotsDirectives;

  // Flags rápidos para "noindex"
  noindex: {
    meta?: boolean;
    header?: boolean;
  };

  // hreflang alternates
  hreflang: HreflangLink[];

  // Posibles "issues" detectados (reglas simples)
  issues: string[];

  // Cadena de redirect si aplica
  redirectChain: RedirectHop[];
}

export interface AuditOutput {
  results: AuditResult[];
}
