import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";
import fs from "node:fs/promises";
import path from "node:path";
import { crawlSite } from "@mcp-crawler/core/crawler/crawl";

const InputSchema = z.object({
  startUrl: z.string().url(),
  depth: z.number().int().min(0).max(6).optional(),
  maxPages: z.number().int().min(1).max(5000).optional(),
  includeSubdomains: z.boolean().optional(),
  userAgent: z.string().optional(),
});

function snapshotPath(startUrl: string) {
  const dir = process.env.CRAWLER_SNAPSHOT_DIR || "./data/snapshots";
  const host = new URL(startUrl).host.replace(/[:/\\]/g, "_");
  const ts = new Date().toISOString().replace(/[:.]/g, "-");
  return path.resolve(process.cwd(), dir, `${host}-${ts}.json`);
}

const routes: FastifyPluginAsync = async (f) => {
  // Health rápido equivalente a GET /api/crawl de tu versión previa
  f.get("/crawl", async () => ({ ok: true, msg: "crawl endpoint ready" }));

  f.post("/crawl", async (req, reply) => {
    try {
      const data = InputSchema.parse(req.body);
      const out = await crawlSite({
        ...data,
        userAgent: data.userAgent ?? process.env.CRAWLER_USER_AGENT ?? "mcp-crawler",
      });

      const file = snapshotPath(data.startUrl);
      await fs.mkdir(path.dirname(file), { recursive: true });
      await fs.writeFile(file, JSON.stringify({ input: data, output: out }, null, 2), "utf8");

      return reply.code(200).send({ ok: true, snapshotFile: file, output: out });
    } catch (e: any) {
      return reply.code(400).send({ ok: false, error: e?.message || String(e) });
    }
  });
};

export default routes;
