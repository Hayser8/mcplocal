import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { crawlSite } from "@mcp-crawler/core/crawler/crawl.js";
import type { CrawlInput } from "@mcp-crawler/core/types/contracts.js";

const CrawlShape = {
  startUrl: z.string().url(),
  depth: z.number().int().min(0).max(6).optional(),
  maxPages: z.number().int().min(1).max(5000).optional(),
  includeSubdomains: z.boolean().optional(),
  userAgent: z.string().optional(),
};
type CrawlArgs = z.infer<z.ZodObject<typeof CrawlShape>>;

export function registerCrawlTool(server: McpServer, uaDefault: string) {
  server.registerTool(
    "crawl.site",
    {
      title: "Crawler",
      description: "Descubre URLs internas respetando robots/sitemaps.",
      inputSchema: CrawlShape,
    },
    async (args: CrawlArgs) => {
      const payload: CrawlInput = {
        ...args,
        depth: typeof args.depth === "number" ? args.depth : 2,
        maxPages: typeof args.maxPages === "number" ? args.maxPages : 500,
        userAgent: args.userAgent || uaDefault,
      };

      const out = await crawlSite(payload);
      const txt = "RESULT_JSON:\n```json\n" + JSON.stringify(out, null, 2) + "\n```";
      return { content: [{ type: "text", text: txt }] };
    }
  );
}
