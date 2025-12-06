/**
 * Prompt registration for Google Slides MCP Server.
 *
 * This module exports the registration function that adds all prompts
 * to the MCP server instance. Prompts provide semantic routing guidance
 * to help LLMs use tools optimally.
 */

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { registerWorkflowPrompts } from "./workflows.js";
import { registerDiscoveryPrompts } from "./discovery.js";

/**
 * Register all prompts with the MCP server.
 *
 * @param server - The MCP server instance
 */
export function registerAllPrompts(server: McpServer): void {
  // Workflow prompts (4 prompts)
  // - create_presentation_from_template
  // - update_existing_presentation
  // - build_presentation_from_scratch
  // - analyze_and_replicate_style
  registerWorkflowPrompts(server);

  // Discovery prompts (3 prompts)
  // - get_started
  // - tool_reference
  // - troubleshooting
  registerDiscoveryPrompts(server);

  // Total: 7 prompts
}
