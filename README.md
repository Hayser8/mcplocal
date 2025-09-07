# mcp-crawler (monorepo)

MCP (Model Context Protocol) server for web crawling and SEO auditing — **no UI included**.  
Monorepo layout: `core` (pure logic), `mcp-server` (STDIO MCP server), and `api` (optional Fastify HTTP API).

## Repository Structure

```
.
├─ packages/
│  └─ core/                    # Crawler/auditor logic (framework-agnostic)
│     ├─ src/
│     │  ├─ audit/indexability.ts
│     │  ├─ crawler/crawl.ts
│     │  ├─ utils/{url,robots,sitemap}.ts
│     │  └─ types/contracts.ts
│     └─ assets/ignore-extensions.txt
├─ apps/
│  ├─ mcp-server/              # MCP server over stdio (bin: `mcp-crawler`)
│  │  └─ src/{index.ts,tools/{crawl.ts,audit.ts}}
│  └─ api/                     # Optional HTTP API (Fastify)
│     └─ src/{index.ts,routes/{audit.ts,crawl.ts}}
├─ tsconfig.base.json
├─ package.json                # workspaces enabled
└─ lockfile (npm or pnpm)      # use **one** lockfile (do not mix)
```

## Requirements

- Node.js **>= 18.17** (Node 20 LTS recommended). Global `fetch` is used.
- A package manager with **workspaces** (npm/pnpm/yarn).
- **Do not mix lockfiles**. Choose npm *or* pnpm and stick to it.

## Environment Variables

Create a `.env` in the repo root (or export in your shell). Recommended values:

```ini
# Crawler
CRAWLER_USER_AGENT=Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124 Safari/537.36
CRAWLER_MAX_CONCURRENCY=6
CRAWLER_DEFAULT_DEPTH=3
CRAWLER_MAX_PAGES=150
CRAWLER_TIMEOUT_MS=20000

# Robots note:
# For local testing you can disable robots to avoid being blocked:
CRAWLER_RESPECT_ROBOTS=0

# Optional HTTP API
PORT=8787
CRAWLER_SNAPSHOT_DIR=./data/snapshots

# Optional: custom ignore list for non-HTML assets
# CRAWLER_IGNORE_EXT_FILE=/absolute/path/to/ignore-extensions.txt

# If you're behind a corporate proxy:
# HTTPS_PROXY=http://user:pass@proxy:8080
# HTTP_PROXY=http://user:pass@proxy:8080
```

> `packages/core/assets/ignore-extensions.txt` ships with a sensible default list (images, binaries, fonts, etc.).

## Installation

From the **repository root**:

```bash
npm i
```

(If you changed dependencies or switched package managers, remove `node_modules` and reinstall.)

## Build

```bash
npm run build
```

This compiles `@mcp-crawler/core`, `apps/mcp-server`, and `apps/api`.

## Quick Smoke Test (no MCP client needed)

Run a direct crawl to verify networking, UA, and basics:

```bash
# Linux/macOS
export CRAWLER_RESPECT_ROBOTS=0
export CRAWLER_USER_AGENT="Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124 Safari/537.36"
npx tsx packages/core/src/scripts/smoke-crawl.ts https://www.ecorefugio.org

# Windows PowerShell
$env:CRAWLER_RESPECT_ROBOTS="0"
$env:CRAWLER_USER_AGENT="Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124 Safari/537.36"
npx tsx packages/core/src/scripts/smoke-crawl.ts https://www.ecorefugio.org
```

**Expected:** `pagesFetched > 0`, some `2xx` in `statusBuckets`, and a snapshot saved under `./tmp/` (or your `CRAWLER_SNAPSHOT_DIR`).

> Many sites/WAFs block unknown UAs. Using a browser-like UA (as above) helps avoid 403/429. For local testing we set `CRAWLER_RESPECT_ROBOTS=0`.

## Run the MCP Server (STDIO)

### Development (hot-reload)

```bash
npm run dev:mcp
```

### Production (compiled)

```bash
npm --workspace apps/mcp-server run build
node apps/mcp-server/dist/index.js
```

### Use the `mcp-crawler` binary

```bash
# create a global symlink to test like a globally installed package
(cd apps/mcp-server && npm link)

# now you can run
mcp-crawler
```

## Example MCP Client Configuration

Configure your MCP-enabled client to launch the server via the `mcp-crawler` command:

```json
{
  "mcpServers": {
    "mcp-crawler": {
      "command": "mcp-crawler",
      "env": {
        "CRAWLER_USER_AGENT": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124 Safari/537.36",
        "CRAWLER_RESPECT_ROBOTS": "0",
        "CRAWLER_TIMEOUT_MS": "20000",
        "CRAWLER_DEFAULT_DEPTH": "3",
        "CRAWLER_MAX_PAGES": "150"
      }
    }
  }
}
```

**Exposed tools**
- `crawler.health`
- `crawl.site` (discovery + robots/sitemap)
- `audit.indexability` (status, canonical, robots/meta/x-robots, hreflang)
- `echo.args` (diagnostics)

## Optional HTTP API

### Development

```bash
npm run dev:api
```

### Production

```bash
npm --workspace apps/api run build
node apps/api/dist/index.js
```

### Basic `curl` checks

```bash
# Health
curl -s http://localhost:8787/healthz

# Crawl
curl -s -X POST http://localhost:8787/api/crawl   -H 'content-type: application/json'   -d '{"startUrl":"https://example.com","depth":2,"maxPages":100}'

# Audit
curl -s -X POST http://localhost:8787/api/audit   -H 'content-type: application/json'   -d '{"urls":["https://example.com/","https://example.com/about"]}'
```

## Development Scripts

- `npm run dev:mcp` — MCP server in hot-reload  
- `npm run dev:api` — HTTP API in hot-reload  
- `npm run build` — builds the entire monorepo

## Troubleshooting

- **`pagesFetched: 0`**
  - Use a browser-like UA via `CRAWLER_USER_AGENT`.
  - For local tests, set `CRAWLER_RESPECT_ROBOTS=0`.
  - Increase `CRAWLER_TIMEOUT_MS` (20s recommended).
  - If you’re behind a proxy, set `HTTPS_PROXY`/`HTTP_PROXY`.

- **`ERR_MODULE_NOT_FOUND`**
  - Install from the **repo root** (`npm i`) so workspaces hoist properly.
  - Don’t mix npm and pnpm lockfiles.

- **Binary `mcp-crawler` not found**
  - Build and/or `npm link` inside `apps/mcp-server`.

---

**License:** MIT 
**Contact:** Maintainers of `mcp-crawler`
