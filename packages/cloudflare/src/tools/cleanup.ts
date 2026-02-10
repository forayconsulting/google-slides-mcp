/**
 * Cleanup tools for removing non-placeholder elements from slides.
 */

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { SlidesClient } from "../api/slides-client.js";
import type { TokenManager } from "../api/token-manager.js";

/**
 * Register cleanup tools with the MCP server.
 */
export function registerCleanupTools(
  server: McpServer,
  tokenManager: TokenManager
): void {
  const client = new SlidesClient(tokenManager);

  /**
   * clear_slide - Remove non-placeholder elements from a slide
   */
  server.tool(
    "clear_slide",
    "Remove non-placeholder elements from a slide. Useful after copy_template to clean up decorative elements (charts, images, icons) while preserving content placeholders (TITLE, BODY, etc.).",
    {
      presentation_id: z.string().describe("The presentation ID"),
      slide_id: z.string().describe("The slide to clear"),
      keep_placeholders: z.boolean().default(true).describe("If true (default), preserve placeholder elements; if false, delete everything"),
    },
    async ({ presentation_id, slide_id, keep_placeholders }) => {
      try {
        const slide = await client.getPage(presentation_id, slide_id);

        const deleteIds: string[] = [];
        let keptCount = 0;

        for (const element of slide.pageElements ?? []) {
          const isPlaceholder = !!element.shape?.placeholder?.type;

          if (keep_placeholders && isPlaceholder) {
            keptCount++;
          } else {
            if (element.objectId) {
              deleteIds.push(element.objectId);
            }
          }
        }

        if (deleteIds.length > 0) {
          const requests = deleteIds.map((objectId) => ({
            deleteObject: { objectId },
          }));
          await client.batchUpdate(presentation_id, requests);
        }

        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify({
                elements_deleted: deleteIds.length,
                elements_kept: keptCount,
              }, null, 2),
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
