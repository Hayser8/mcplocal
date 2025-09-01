import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { registerCrawlTool } from "./tools/crawl";
import { registerAuditTool } from "./tools/audit";

const UA = process.env.CRAWLER_USER_AGENT || "mcp-crawler";

// logs por stderr
function d(label: string, obj?: unknown) {
  try {
    const base = `[mcp-crawler] ${label}`;
    if (obj === undefined) return console.error(base);
    const peek = typeof obj === "string" ? obj : (() => {
      try { return JSON.stringify(obj).slice(0, 1000); } catch { return String(obj); }
    })();
    console.error(base, peek);
  } catch {}
}

const server = new McpServer({ name: "mcp-crawler", version: "0.4.0" });
d("boot", { UA, node: process.version });

// Herramienta echo
server.registerTool(
  "echo.args",
  { title: "Echo", description: "Devuelve args tal como llegaron al handler", inputSchema: {} },
  async (args: Record<string, unknown> = {}) => {
    d("handler:echo.args ARGS", args);
    const txt = "RESULT_JSON:\n```json\n" + JSON.stringify({ args }, null, 2) + "\n```";
    return { content: [{ type: "text", text: txt }] };
  }
);

// Health local
server.registerTool(
  "crawler.health",
  { title: "Health", description: "Liveness del MCP server", inputSchema: {} },
  async () => ({ content: [{ type: "text", text: "OK: MCP server vivo" }] })
);

// Tools modulares
registerCrawlTool(server, UA);
registerAuditTool(server, UA);

// Conexión STDIO
const transport = new StdioServerTransport();
await server.connect(transport);
d("connected:stdio");
