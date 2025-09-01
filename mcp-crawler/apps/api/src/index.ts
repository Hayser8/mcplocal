import Fastify from "fastify";
import auditRoutes from "./routes/audit.js";
import crawlRoutes from "./routes/crawl.js";

const fastify = Fastify({ logger: true });

fastify.get("/healthz", async () => ({ ok: true }));

fastify.register(auditRoutes, { prefix: "/api" });
fastify.register(crawlRoutes, { prefix: "/api" });

const PORT = Number(process.env.PORT || 8787);
await fastify.listen({ port: PORT, host: "0.0.0.0" });
