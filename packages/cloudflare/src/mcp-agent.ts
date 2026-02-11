/**
 * Google Slides MCP Agent.
 *
 * Extends McpAgent to provide Google Slides functionality through MCP tools.
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { McpAgent } from "agents/mcp";
import type { Props } from "./types.js";
import { registerAllTools } from "./tools/index.js";
import { registerAllPrompts } from "./prompts/index.js";

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
  server = new McpServer(
    {
      name: "Google Slides MCP Server",
      version: "1.0.0",
    },
    {
      instructions: `Google Slides MCP Server provides tools for creating and manipulating Google Slides presentations. Use the semantic tools (position_element, add_text_box, etc.) for common operations, or use batch_update for full API access.

## Critical Behavioral Guidelines

1. NEVER FABRICATE CONTENT. If the source material (transcript, brief, etc.) does not explicitly state a person's role, a specific date, a metric, or any factual claim, ASK THE USER to confirm before inserting it. Guessing names, titles, roles, or data erodes trust in the output.

2. INSPECT BEFORE YOU EDIT. Before modifying a slide, use inspect_slide (or get_page) to understand its current element structure. Many slides have complex visual layouts (Gantt charts, infographics, multi-column designs) where blindly replacing text produces nonsensical results.

3. VALIDATE AFTER YOU EDIT. After making changes, use inspect_slide to check for overflow warnings, empty placeholders, and formatting issues. Fix any problems before moving to the next slide.

4. RESPECT EXISTING FORMATTING. When replacing text in styled elements:
   - Do NOT insert bullet characters (•, -, *) into cells/shapes that already have paragraph-level bullet formatting.
   - Do NOT assume font sizes — inspect the existing formatting first.
   - When using batch_update to insert text, also set updateTextStyle to maintain consistent formatting.

5. UNDERSTAND SPATIAL RELATIONSHIPS. Elements like Gantt bars, timeline phases, and infographic connectors are positioned by absolute transforms. If you change column headers or date ranges, you MUST also reposition the visual elements to match.

Authentication is required. Ensure you have valid Google OAuth credentials configured.`,
    }
  );

  /**
   * Initialize the MCP agent and register all tools.
   */
  async init(): Promise<void> {
    if (!this.props) {
      throw new Error("User props not available - OAuth may not have completed");
    }
    registerAllTools(this.server, this.env, this.props);
    registerAllPrompts(this.server);
  }
}
