import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { auditIndexability } from "@mcp-crawler/core/audit/indexability.js";
import type { AuditInput } from "@mcp-crawler/core/types/contracts.js";

const AuditShape = {
  urls: z.array(z.string().url()).min(1).max(200),
  userAgent: z.string().optional(),
};
type AuditArgs = z.infer<z.ZodObject<typeof AuditShape>>;

export function registerAuditTool(server: McpServer, uaDefault: string) {
  server.registerTool(
    "audit.indexability",
    {
      title: "Auditor SEO",
      description: "Indexabilidad: status, canonical, noindex, hreflang.",
      inputSchema: AuditShape,
    },
    async (args: AuditArgs) => {
      const payload: AuditInput = {
        urls: args.urls,
        userAgent: args.userAgent || uaDefault,
      };
      const out = await auditIndexability(payload);
      const txt = "RESULT_JSON:\n```json\n" + JSON.stringify(out, null, 2) + "\n```";
      return { content: [{ type: "text", text: txt }] };
    }
  );
}
