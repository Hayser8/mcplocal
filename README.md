# mcp-crawler (monorepo)

Servidor **MCP** (Model Context Protocol) de crawling y auditoría SEO, sin UI.  
Arquitectura en monorepo: `core` (lógica pura), `mcp-server` (STDIO), y `api` (Fastify opcional).

## Estructura

```
.
├─ packages/
│  └─ core/                    # Lógica de crawler/auditor (sin framework)
│     ├─ src/
│     │  ├─ audit/indexability.ts
│     │  ├─ crawler/crawl.ts
│     │  ├─ utils/{url,robots,sitemap}.ts
│     │  └─ types/contracts.ts
│     └─ assets/ignore-extensions.txt
├─ apps/
│  ├─ mcp-server/              # Servidor MCP por stdio (bin: `mcp-crawler`)
│  │  └─ src/{index.ts, tools/{crawl.ts,audit.ts}}
│  └─ api/                     # API HTTP opcional (Fastify)
│     └─ src/{index.ts, routes/{audit.ts,crawl.ts}}
├─ tsconfig.base.json
├─ package.json                # workspaces
└─ pnpm-lock.yaml / package-lock.json (según gestor)
```

## Requisitos

- Node.js **>= 18.17** (incluye `fetch` global)
- npm (o pnpm/yarn) con **workspaces** habilitados

## Variables de entorno

Crea `.env` (o exporta en tu shell). Ejemplo:

```
CRAWLER_USER_AGENT=mcp-crawler
CRAWLER_MAX_CONCURRENCY=6
CRAWLER_DEFAULT_DEPTH=2
CRAWLER_MAX_PAGES=500
CRAWLER_RESPECT_ROBOTS=1

# API opcional
PORT=8787
CRAWLER_SNAPSHOT_DIR=./data/snapshots

# Opcional: ruta custom de extensiones a ignorar
# CRAWLER_IGNORE_EXT_FILE=/ruta/absoluta/ignore-extensions.txt
```

> `packages/core/assets/ignore-extensions.txt` ya trae una lista razonable (imágenes, binarios, fuentes, etc).

## Instalación

En la **raíz** del repo:

```bash
npm i
```

Esto instala todas las dependencias de los tres paquetes vía workspaces.

## Build

```bash
npm run build
```

- Compila `@mcp-crawler/core`, `mcp-server` y `api`.

## Ejecutar MCP server (STDIO)

### Desarrollo (hot-reload)
```bash
npm run dev:mcp
```

### Producción (compilado)
```bash
npm --workspace apps/mcp-server run build
node apps/mcp-server/dist/index.js
```

### Usar el binario `mcp-crawler`
Para testear local como si estuviera instalado global:

```bash
# crea symlink global
(cd apps/mcp-server && npm link)

# ahora puedes ejecutar el bin
mcp-crawler
```

## Configurar tu cliente MCP

Ejemplo genérico de configuración:

```json
{
  "mcpServers": {
    "mcp-crawler": {
      "command": "mcp-crawler",
      "env": {
        "CRAWLER_USER_AGENT": "mcp-crawler",
        "CRAWLER_RESPECT_ROBOTS": "1"
      }
    }
  }
}
```

Herramientas expuestas:
- `crawler.health`
- `crawl.site` (descubrimiento + robots/sitemap)
- `audit.indexability` (status, canonical, robots/meta/x-robots, hreflang)
- `echo.args` (diagnóstico)

## Ejecutar API HTTP (opcional)

### Desarrollo
```bash
npm run dev:api
```

### Producción
```bash
npm --workspace apps/api run build
node apps/api/dist/index.js
```

### Probar con `curl`

```bash
# Health
curl -s http://localhost:8787/healthz

# Crawl
curl -s -X POST http://localhost:8787/api/crawl   -H 'content-type: application/json'   -d '{"startUrl":"https://example.com","depth":2,"maxPages":100}'

# Audit
curl -s -X POST http://localhost:8787/api/audit   -H 'content-type: application/json'   -d '{"urls":["https://example.com/","https://example.com/about"]}'
```

## Desarrollo

- `npm run dev:mcp` — hot reload del MCP server
- `npm run dev:api` — hot reload del API
- `npm run build` — build de todo el monorepo

## Publicación en npm (opcional)

Publicar el core:
```bash
npm publish --workspace packages/core
```

Publicar el server (bin):
```bash
npm publish --workspace apps/mcp-server
```

> Asegúrate de **actualizar versiones** y de tener `files` y `exports` correctos en cada `package.json`.

## Troubleshooting

- **`ERR_MODULE_NOT_FOUND`**: ejecuta `npm i` en la raíz (no en subcarpetas).
- **No aparece el bin `mcp-crawler`**: compila y/o `npm link` dentro de `apps/mcp-server`.
- **Robots/sitemaps no respetados**: revisa `CRAWLER_RESPECT_ROBOTS=1` y `CRAWLER_USER_AGENT`.
- **Crawl de PDFs/imágenes**: edita `packages/core/assets/ignore-extensions.txt` o usa `CRAWLER_IGNORE_EXT_FILE`.
