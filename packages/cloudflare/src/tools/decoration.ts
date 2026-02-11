/**
 * Decoration tools for Google Slides.
 *
 * Tools for slide backgrounds, lines, and other decorative elements.
 */

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { SlidesClient } from "../api/slides-client.js";
import type { TokenManager } from "../api/token-manager.js";
import { inchesToEmu } from "../utils/units.js";
import { hexToRgb } from "../utils/colors.js";

function generateId(prefix: string): string {
  return `${prefix}_${Math.random().toString(36).substring(2, 10)}`;
}

/**
 * Register decoration tools with the MCP server.
 */
export function registerDecorationTools(
  server: McpServer,
  tokenManager: TokenManager
): void {
  const client = new SlidesClient(tokenManager);

  /**
   * set_slide_background - Set a slide's background color or image
   */
  server.tool(
    "set_slide_background",
    "Set a slide's background to a solid color or a stretched image.",
    {
      presentation_id: z.string().describe("The presentation ID"),
      slide_id: z.string().describe("The slide to update"),
      color: z.string().optional().describe("Background color hex (e.g., '#054950'). Mutually exclusive with image_url"),
      image_url: z.string().optional().describe("Background image URL (stretched to fill). Mutually exclusive with color"),
    },
    async ({ presentation_id, slide_id, color, image_url }) => {
      try {
        if (!color && !image_url) {
          return {
            content: [{ type: "text" as const, text: "Error: Must provide either color or image_url" }],
            isError: true,
          };
        }
        if (color && image_url) {
          return {
            content: [{ type: "text" as const, text: "Error: Provide either color or image_url, not both" }],
            isError: true,
          };
        }

        let pageBackgroundFill: Record<string, unknown>;
        let fields: string;

        if (color) {
          pageBackgroundFill = {
            solidFill: {
              color: { rgbColor: hexToRgb(color) },
            },
          };
          fields = "pageBackgroundFill.solidFill.color";
        } else {
          pageBackgroundFill = {
            stretchedPictureFill: {
              contentUrl: image_url,
            },
          };
          fields = "pageBackgroundFill.stretchedPictureFill.contentUrl";
        }

        await client.batchUpdate(presentation_id, [
          {
            updatePageProperties: {
              objectId: slide_id,
              pageProperties: { pageBackgroundFill },
              fields,
            },
          },
        ]);

        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify({ slide_id, background: color ? "solid_color" : "image" }, null, 2),
            },
          ],
        };
      } catch (error) {
        return {
          content: [{ type: "text" as const, text: `Error: ${error instanceof Error ? error.message : String(error)}` }],
          isError: true,
        };
      }
    }
  );

  /**
   * add_line - Add a line or divider to a slide
   */
  server.tool(
    "add_line",
    "Add a straight line to a slide. Use for dividers, connectors, and decorative elements.",
    {
      presentation_id: z.string().describe("The presentation ID"),
      slide_id: z.string().describe("The slide to add the line to"),
      start_x: z.number().describe("Start X position in inches"),
      start_y: z.number().describe("Start Y position in inches"),
      end_x: z.number().describe("End X position in inches"),
      end_y: z.number().describe("End Y position in inches"),
      color: z.string().default("#DADCE0").describe("Line color hex"),
      weight: z.number().default(1).describe("Line weight in points"),
      dash_style: z.enum(["SOLID", "DOT", "DASH", "DASH_DOT", "LONG_DASH", "LONG_DASH_DOT"]).default("SOLID").describe("Line dash style"),
    },
    async ({ presentation_id, slide_id, start_x, start_y, end_x, end_y, color, weight, dash_style }) => {
      try {
        const elementId = generateId("line");

        // Calculate size as absolute delta between endpoints
        const deltaX = end_x - start_x;
        const deltaY = end_y - start_y;

        // Width/height must be positive (absolute values)
        const widthInches = Math.abs(deltaX);
        const heightInches = Math.abs(deltaY);

        // Use scale -1 to flip direction when delta is negative
        const scaleX = deltaX >= 0 ? 1 : -1;
        const scaleY = deltaY >= 0 ? 1 : -1;

        // Translate to the minimum coordinate
        const translateX = Math.min(start_x, end_x);
        const translateY = Math.min(start_y, end_y);

        // For zero-length dimensions, use a minimal size to avoid API errors
        const sizeWidth = Math.max(widthInches, 0.001);
        const sizeHeight = Math.max(heightInches, 0.001);

        const requests: Record<string, unknown>[] = [
          {
            createLine: {
              objectId: elementId,
              lineCategory: "STRAIGHT",
              elementProperties: {
                pageObjectId: slide_id,
                size: {
                  width: { magnitude: inchesToEmu(sizeWidth), unit: "EMU" },
                  height: { magnitude: inchesToEmu(sizeHeight), unit: "EMU" },
                },
                transform: {
                  scaleX,
                  scaleY,
                  shearX: 0,
                  shearY: 0,
                  translateX: inchesToEmu(translateX),
                  translateY: inchesToEmu(translateY),
                  unit: "EMU",
                },
              },
            },
          },
          {
            updateLineProperties: {
              objectId: elementId,
              lineProperties: {
                lineFill: {
                  solidFill: {
                    color: { rgbColor: hexToRgb(color) },
                  },
                },
                weight: { magnitude: weight, unit: "PT" },
                dashStyle: dash_style,
              },
              fields: "lineFill.solidFill.color,weight,dashStyle",
            },
          },
        ];

        await client.batchUpdate(presentation_id, requests);

        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify({ element_id: elementId }, null, 2),
            },
          ],
        };
      } catch (error) {
        return {
          content: [{ type: "text" as const, text: `Error: ${error instanceof Error ? error.message : String(error)}` }],
          isError: true,
        };
      }
    }
  );
}
