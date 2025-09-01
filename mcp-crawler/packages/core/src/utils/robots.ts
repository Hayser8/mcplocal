import robotsParserLib from "robots-parser";

export interface RobotsAgent {
  isAllowed: (url: string) => boolean;
  crawlDelay?: number;
  sitemaps: string[];
}

type ParserWithDelay = {
  isAllowed: (url: string, ua?: string) => boolean | null;
  getSitemaps?: () => string[] | null;
  getCrawlDelay?: (ua: string) => number | undefined;
};

const cache = new Map<string, RobotsAgent>();

/** Cast robusto para evitar "no call signatures" */
type RobotsParserFactory = (robotsUrl: string, body: string) => ParserWithDelay;
const robotsParser = robotsParserLib as unknown as RobotsParserFactory;

/**
 * Devuelve un agente robots para el origin dado.
 * Cachea por origin. Si robots.txt es inaccesible, permite todo.
 */
export async function getRobotsAgent(origin: string, userAgent: string): Promise<RobotsAgent> {
  if (cache.has(origin)) return cache.get(origin)!;

  const robotsUrl = new URL("/robots.txt", origin).toString();
  let body = "";
  try {
    const res = await fetch(robotsUrl, { headers: { "User-Agent": userAgent } });
    body = await res.text();
  } catch {
    const agent: RobotsAgent = { isAllowed: () => true, sitemaps: [] };
    cache.set(origin, agent);
    return agent;
  }

  const parser = robotsParser(robotsUrl, body);

  const sitemaps = parser.getSitemaps?.() ?? [];
  const crawlDelay =
    parser.getCrawlDelay?.(userAgent) ??
    parser.getCrawlDelay?.("*");

  const agent: RobotsAgent = {
    isAllowed: (url: string) => parser.isAllowed(url, userAgent) ?? true,
    crawlDelay: typeof crawlDelay === "number" ? crawlDelay : undefined,
    sitemaps,
  };

  cache.set(origin, agent);
  return agent;
}
