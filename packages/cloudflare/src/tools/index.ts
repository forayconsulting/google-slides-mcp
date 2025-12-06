/**
 * Tool registration for Google Slides MCP Server.
 *
 * This module exports the registration function that adds all tools
 * to the MCP server instance.
 */

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { Props } from "../types.js";
import { TokenManager } from "../api/token-manager.js";
import { registerLowLevelTools } from "./low-level.js";
import { registerUtilityTools } from "./utility.js";
import { registerTemplateTools } from "./templates.js";
import { registerCreationTools } from "./creation.js";
import { registerPositioningTools } from "./positioning.js";
import { registerContentTools } from "./content.js";
import { registerAnalysisTools } from "./analysis.js";

/**
 * Register all tools with the MCP server.
 *
 * @param server - The MCP server instance
 * @param env - The Cloudflare Worker environment
 * @param props - User props including access token
 */
export function registerAllTools(
  server: McpServer,
  env: Env,
  props: Props
): void {
  // Create a token manager that handles automatic refresh
  const tokenManager = new TokenManager({
    accessToken: props.accessToken,
    refreshToken: props.refreshToken,
    expiresAt: props.expiresAt,
    clientId: env.GOOGLE_CLIENT_ID,
    clientSecret: env.GOOGLE_CLIENT_SECRET,
  });

  // Priority 1: Low-level API tools (3 tools)
  // - batch_update, get_presentation, get_page
  registerLowLevelTools(server, tokenManager);

  // Priority 2: Utility tools (3 tools)
  // - list_slides, get_element_info, export_thumbnail
  registerUtilityTools(server, tokenManager);

  // Priority 3: Template tools (4 tools)
  // - copy_template, replace_placeholders, replace_placeholder_with_image, search_presentations
  registerTemplateTools(server, tokenManager);

  // Priority 4-5: Creation tools (4 tools)
  // - create_slide, add_text_box, add_image, add_shape
  registerCreationTools(server, tokenManager);

  // Priority 6: Content tools (3 tools)
  // - update_slide_content, update_presentation_content, apply_text_style
  registerContentTools(server, tokenManager);

  // Priority 7: Positioning tools (3 tools)
  // - position_element, align_elements, distribute_elements
  registerPositioningTools(server, tokenManager);

  // Priority 9: Analysis tools (1 tool)
  // - analyze_presentation
  registerAnalysisTools(server, tokenManager);

  // Total: 21 tools
}
