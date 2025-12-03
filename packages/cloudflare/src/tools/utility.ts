/**
 * Utility tools for inspecting and managing presentations.
 *
 * Tools for listing slides, getting element information, and exporting thumbnails.
 */

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { SlidesClient } from "../api/slides-client.js";
import type { Props } from "../types.js";
import { extractElementBounds } from "../utils/transforms.js";
import { emuToInches } from "../utils/units.js";

/**
 * Register utility tools with the MCP server.
 */
export function registerUtilityTools(
  server: McpServer,
  _env: Env,
  props: Props
): void {
  const client = new SlidesClient({ accessToken: props.accessToken });

  /**
   * list_slides - List all slides with their IDs, titles, and element counts
   */
  server.tool(
    "list_slides",
    "List all slides with their IDs, titles, and element counts.",
    {
      presentation_id: z.string().describe("The presentation to list slides from"),
    },
    async ({ presentation_id }) => {
      try {
        const presentation = await client.getPresentation(presentation_id);

        const slidesInfo = (presentation.slides ?? []).map((slide, i) => {
          const slideId = slide.objectId ?? "";
          const elementCount = (slide.pageElements ?? []).length;

          // Try to extract title from title placeholder
          let title = "";
          for (const element of slide.pageElements ?? []) {
            const shape = element.shape;
            const placeholder = shape?.placeholder;
            if (placeholder?.type === "TITLE") {
              const textElements = shape?.text?.textElements ?? [];
              for (const textElem of textElements) {
                const content = textElem.textRun?.content ?? "";
                if (content.trim()) {
                  title = content.trim();
                  break;
                }
              }
              break;
            }
          }

          return {
            slide_id: slideId,
            index: i,
            title,
            element_count: elementCount,
          };
        });

        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify(slidesInfo, null, 2),
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
   * get_element_info - Get detailed information about a page element
   */
  server.tool(
    "get_element_info",
    "Get detailed information about a page element. Returns position, size, and properties in human-readable format using inches instead of EMUs.",
    {
      presentation_id: z.string().describe("The presentation containing the element"),
      element_id: z.string().describe("The element to get info about"),
    },
    async ({ presentation_id, element_id }) => {
      try {
        const presentation = await client.getPresentation(presentation_id);

        // Find the element
        let element: Record<string, unknown> | null = null;
        for (const slide of presentation.slides ?? []) {
          for (const pageElement of slide.pageElements ?? []) {
            if (pageElement.objectId === element_id) {
              element = pageElement as unknown as Record<string, unknown>;
              break;
            }
          }
          if (element) break;
        }

        if (!element) {
          throw new Error(`Element ${element_id} not found`);
        }

        // Extract basic info
        const bounds = extractElementBounds(element as Parameters<typeof extractElementBounds>[0]);

        const info: Record<string, unknown> = {
          id: element_id,
          position: {
            x_inches: emuToInches(bounds.x),
            y_inches: emuToInches(bounds.y),
          },
          size: {
            width_inches: emuToInches(bounds.width),
            height_inches: emuToInches(bounds.height),
          },
        };

        // Determine type and type-specific info
        if (element.shape) {
          const shape = element.shape as Record<string, unknown>;
          info.type = "SHAPE";
          info.shape_type = (shape.shapeType as string) ?? "UNKNOWN";

          // Extract text if present
          let textContent = "";
          const text = shape.text as Record<string, unknown> | undefined;
          const textElements = (text?.textElements as Array<Record<string, unknown>>) ?? [];
          for (const textElem of textElements) {
            const textRun = textElem.textRun as Record<string, unknown> | undefined;
            textContent += (textRun?.content as string) ?? "";
          }
          if (textContent.trim()) {
            info.text = textContent.trim();
          }

          // Check for placeholder
          const placeholder = shape.placeholder as Record<string, unknown> | undefined;
          if (placeholder) {
            info.placeholder_type = placeholder.type;
          }
        } else if (element.image) {
          info.type = "IMAGE";
          const image = element.image as Record<string, unknown>;
          info.image_url = image.sourceUrl ?? "";
          info.content_url = image.contentUrl ?? "";
        } else if (element.table) {
          info.type = "TABLE";
          const table = element.table as Record<string, unknown>;
          info.rows = table.rows ?? 0;
          info.columns = table.columns ?? 0;
        } else if (element.line) {
          info.type = "LINE";
          const line = element.line as Record<string, unknown>;
          info.line_type = line.lineType ?? "UNKNOWN";
        } else if (element.video) {
          info.type = "VIDEO";
          const video = element.video as Record<string, unknown>;
          info.video_source = video.source ?? "UNKNOWN";
          info.video_url = video.url ?? "";
        } else {
          info.type = "UNKNOWN";
        }

        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify(info, null, 2),
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
   * export_thumbnail - Generate a thumbnail image of a slide
   */
  server.tool(
    "export_thumbnail",
    "Generate a thumbnail image of a slide.",
    {
      presentation_id: z.string().describe("The presentation ID"),
      slide_id: z.string().describe("The slide to generate a thumbnail for"),
      mime_type: z.enum(["PNG", "JPEG"]).default("PNG").describe("Image format"),
    },
    async ({ presentation_id, slide_id, mime_type }) => {
      try {
        const thumbnail = await client.getThumbnail(presentation_id, slide_id, mime_type);

        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify({
                content_url: thumbnail.contentUrl ?? "",
                width: thumbnail.width ?? 0,
                height: thumbnail.height ?? 0,
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
