declare module "@modelcontextprotocol/sdk/server/mcp.js" {
  export class McpServer {
    constructor(opts?: any, options?: any);
    registerTool(...args: any[]): any;
    registerResource(...args: any[]): any;
    registerPrompt(...args: any[]): any;
    connect(...args: any[]): Promise<void>;
  }
}
declare module "@modelcontextprotocol/sdk/server/stdio.js" {
  export class StdioServerTransport {
    constructor(...args: any[]);
  }
}
