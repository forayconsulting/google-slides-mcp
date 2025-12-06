/**
 * Low-level tools providing direct access to Google Slides API.
 *
 * These tools expose the raw Google Slides API capabilities for power users
 * who need full control over their presentations.
 */

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { SlidesClient } from "../api/slides-client.js";
import type { TokenManager } from "../api/token-manager.js";

/**
 * Register low-level API tools with the MCP server.
 */
export function registerLowLevelTools(
  server: McpServer,
  tokenManager: TokenManager
): void {
  const client = new SlidesClient(tokenManager);

  /**
   * batch_update - Execute raw batchUpdate requests
   */
  server.tool(
    "batch_update",
    "Execute raw batchUpdate requests against Google Slides API. WHEN TO USE: Only when semantic tools don't cover your use case - e.g., deleting slides (deleteObject), table operations, animations, grouping elements. PREFER INSTEAD: replace_placeholders for text replacement, update_slide_content for placeholder updates, position_element for moving/resizing. All 47 API request types supported.",
    {
      presentation_id: z.string().describe("The ID of the presentation to modify"),
      requests: z.array(z.record(z.unknown())).describe("Array of request objects (createSlide, insertText, updatePageElementTransform, etc.)"),
    },
    async ({ presentation_id, requests }) => {
      try {
        const result = await client.batchUpdate(presentation_id, requests);
        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify(result, null, 2),
            },
          ],
        };
      } catch (error) {
        return {
          content: [
            {
              type: "text" as const,
              text: `Error: ${error instanceof Error ? error.message : String(error)}`,
            },
          ],
          isError: true,
        };
      }
    }
  );

  /**
   * get_presentation - Retrieve presentation metadata
   */
  server.tool(
    "get_presentation",
    "Retrieve raw presentation metadata, slides, and elements. Returns EMU units and raw API structures. PREFER INSTEAD: list_slides for slide overview, analyze_presentation for style/structure analysis, get_element_info for element details in inches.",
    {
      presentation_id: z.string().describe("The ID of the presentation to retrieve"),
      fields: z.string().optional().describe("Optional field mask for partial response (e.g., 'slides.pageElements' to get only elements)"),
    },
    async ({ presentation_id, fields }) => {
      try {
        const result = await client.getPresentation(presentation_id, fields ?? undefined);
        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify(result, null, 2),
            },
          ],
        };
      } catch (error) {
        return {
          content: [
            {
              type: "text" as const,
              text: `Error: ${error instanceof Error ? error.message : String(error)}`,
            },
          ],
          isError: true,
        };
      }
    }
  );

  /**
   * get_page - Get detailed information about a specific slide/page
   */
  server.tool(
    "get_page",
    "Get raw slide/page data with transforms and properties in EMU units. PREFER INSTEAD: get_element_info for element details in inches, list_slides for slide overview. Used internally by update_slide_content.",
    {
      presentation_id: z.string().describe("The ID of the presentation"),
      page_id: z.string().describe("The object ID of the page/slide to retrieve"),
    },
    async ({ presentation_id, page_id }) => {
      try {
        const result = await client.getPage(presentation_id, page_id);
        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify(result, null, 2),
            },
          ],
        };
      } catch (error) {
        return {
          content: [
            {
              type: "text" as const,
              text: `Error: ${error instanceof Error ? error.message : String(error)}`,
            },
          ],
          isError: true,
        };
      }
    }
  );
}
