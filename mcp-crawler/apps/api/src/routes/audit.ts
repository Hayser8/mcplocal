import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";
import { auditIndexability } from "@mcp-crawler/core";

const InputSchema = z.object({
  urls: z.array(z.string().url()).min(1).max(200),
  userAgent: z.string().optional(),
});

const routes: FastifyPluginAsync = async (f) => {
  f.post("/audit", async (req, reply) => {
    try {
      const data = InputSchema.parse(req.body);
      const out = await auditIndexability({
        ...data,
        userAgent: data.userAgent ?? process.env.CRAWLER_USER_AGENT ?? "mcp-crawler",
      });
      return reply.code(200).send({ ok: true, results: out.results });
    } catch (e: any) {
      return reply.code(400).send({ ok: false, error: e?.message || String(e) });
    }
  });
};

export default routes;
