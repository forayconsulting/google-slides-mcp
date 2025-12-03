/**
 * Low-level tools providing direct access to Google Slides API.
 *
 * These tools expose the raw Google Slides API capabilities for power users
 * who need full control over their presentations.
 */

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { SlidesClient } from "../api/slides-client.js";
import type { Props } from "../types.js";

/**
 * Register low-level API tools with the MCP server.
 */
export function registerLowLevelTools(
  server: McpServer,
  _env: Env,
  props: Props
): void {
  const client = new SlidesClient({ accessToken: props.accessToken });

  /**
   * batch_update - Execute raw batchUpdate requests
   */
  server.tool(
    "batch_update",
    "Execute raw batchUpdate requests against Google Slides API. Use this for full control when semantic tools don't cover your use case. All 47 Google Slides API request types are supported.",
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
    "Retrieve presentation metadata, slides, and elements. Returns full presentation object or requested fields including presentationId, pageSize, slides, title, masters, and layouts.",
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
    "Get detailed information about a specific slide/page. Returns page elements with their current transforms, sizes, and properties including objectId, pageType, pageElements, slideProperties, and pageProperties.",
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
