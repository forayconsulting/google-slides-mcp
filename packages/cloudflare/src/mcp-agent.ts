/**
 * Google Slides MCP Agent.
 *
 * Extends McpAgent to provide Google Slides functionality through MCP tools.
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { McpAgent } from "agents/mcp";
import type { Props } from "./types.js";
import { registerAllTools } from "./tools/index.js";

/**
 * Google Slides MCP Server agent.
 *
 * This class extends McpAgent to create a Durable Object that handles
 * MCP connections and provides Google Slides tools to clients.
 */
export class GoogleSlidesMCP extends McpAgent<Env, Record<string, never>, Props> {
  /**
   * The MCP server instance.
   */
  server = new McpServer({
    name: "Google Slides MCP Server",
    version: "1.0.0",
  });

  /**
   * Initialize the MCP agent and register all tools.
   */
  async init(): Promise<void> {
    if (!this.props) {
      throw new Error("User props not available - OAuth may not have completed");
    }
    registerAllTools(this.server, this.env, this.props);
  }
}
