// packages/core/src/scripts/smoke-crawl.ts
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { crawlSite } from "../crawler/crawl.js";

// Permite pasar la URL por CLI: node/tsx smoke-crawl.ts https://dominio
const startUrl = process.argv[2] ?? "https://www.ecorefugio.org";

async function main() {
  const out = await crawlSite({
    startUrl,
    depth: 3,
    maxPages: 100,
    includeSubdomains: false,
    // Si no pones nada, usa el UA por defecto que definiste en crawl.ts
    userAgent: process.env.CRAWLER_USER_AGENT, 
  });

  console.log("=== STATS ===");
  console.log(out.stats);
  console.log("statusBuckets:", out.reports.statusBuckets);
  console.log("linkedNotInSitemap (top 10):", out.reports.linkedNotInSitemap.slice(0, 10));

  const outFile = path.resolve(
    process.cwd(),
    "tmp",
    `snapshot-${new Date().toISOString().replace(/[:.]/g, "-")}.json`
  );
  await mkdir(path.dirname(outFile), { recursive: true });
  await writeFile(outFile, JSON.stringify(out, null, 2), "utf8");
  console.log("Snapshot guardado en:", outFile);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
