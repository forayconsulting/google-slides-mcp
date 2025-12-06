/**
 * Creation tools for adding elements to Google Slides.
 *
 * Tools for creating slides, text boxes, images, and shapes with
 * intuitive parameters using inches instead of EMUs.
 */

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { SlidesClient } from "../api/slides-client.js";
import type { TokenManager } from "../api/token-manager.js";
import { inchesToEmu } from "../utils/units.js";
import { hexToRgb } from "../utils/colors.js";
import { SLIDE_SIZES, calculateAlignmentPosition } from "../utils/transforms.js";

function generateId(prefix: string): string {
  return `${prefix}_${Math.random().toString(36).substring(2, 10)}`;
}

/**
 * Register creation tools with the MCP server.
 */
export function registerCreationTools(
  server: McpServer,
  tokenManager: TokenManager
): void {
  const client = new SlidesClient(tokenManager);

  /**
   * create_slide - Create a new slide with the specified layout
   */
  server.tool(
    "create_slide",
    "Create a new slide with the specified layout.",
    {
      presentation_id: z.string().describe("The presentation to add the slide to"),
      layout: z.enum([
        "BLANK", "TITLE", "TITLE_AND_BODY", "TITLE_AND_TWO_COLUMNS",
        "TITLE_ONLY", "SECTION_HEADER", "ONE_COLUMN_TEXT", "MAIN_POINT",
        "BIG_NUMBER", "CAPTION_ONLY"
      ]).default("BLANK").describe("The layout type for the new slide"),
      insertion_index: z.number().optional().describe("Position to insert (null = append at end)"),
    },
    async ({ presentation_id, layout, insertion_index }) => {
      try {
        const slideId = generateId("slide");

        const request: Record<string, unknown> = {
          createSlide: {
            objectId: slideId,
            slideLayoutReference: { predefinedLayout: layout },
          },
        };

        if (insertion_index !== undefined) {
          (request.createSlide as Record<string, unknown>).insertionIndex = insertion_index;
        }

        await client.batchUpdate(presentation_id, [request]);

        // Get the created slide to find placeholder IDs
        const slideInfo = await client.getPage(presentation_id, slideId);
        const placeholderIds: Record<string, string> = {};
        for (const element of slideInfo.pageElements ?? []) {
          const placeholder = element.shape?.placeholder;
          if (placeholder) {
            const placeholderType = placeholder.type ?? "UNKNOWN";
            placeholderIds[placeholderType] = element.objectId ?? "";
          }
        }

        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify({
                slide_id: slideId,
                placeholder_ids: placeholderIds,
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

  /**
   * add_text_box - Add a text box with styling to a slide
   */
  server.tool(
    "add_text_box",
    "Add a text box with styling to a slide.",
    {
      presentation_id: z.string().describe("The presentation ID"),
      slide_id: z.string().describe("The slide to add the text box to"),
      text: z.string().describe("The text content"),
      x: z.number().default(1).describe("X position in inches from left edge"),
      y: z.number().default(1).describe("Y position in inches from top edge"),
      width: z.number().default(4).describe("Width in inches"),
      height: z.number().default(1).describe("Height in inches"),
      font_size: z.number().default(18).describe("Font size in points"),
      font_family: z.string().default("Arial").describe("Font family name"),
      bold: z.boolean().default(false).describe("Whether text is bold"),
      italic: z.boolean().default(false).describe("Whether text is italic"),
      color: z.string().default("#000000").describe("Text color as hex"),
      alignment: z.enum(["LEFT", "CENTER", "RIGHT"]).default("LEFT").describe("Text alignment"),
    },
    async ({ presentation_id, slide_id, text, x, y, width, height, font_size, font_family, bold, italic, color, alignment }) => {
      try {
        const elementId = generateId("textbox");

        const requests = [
          // Create the text box shape
          {
            createShape: {
              objectId: elementId,
              shapeType: "TEXT_BOX",
              elementProperties: {
                pageObjectId: slide_id,
                size: {
                  width: { magnitude: inchesToEmu(width), unit: "EMU" },
                  height: { magnitude: inchesToEmu(height), unit: "EMU" },
                },
                transform: {
                  scaleX: 1,
                  scaleY: 1,
                  shearX: 0,
                  shearY: 0,
                  translateX: inchesToEmu(x),
                  translateY: inchesToEmu(y),
                  unit: "EMU",
                },
              },
            },
          },
          // Insert the text
          {
            insertText: {
              objectId: elementId,
              text,
              insertionIndex: 0,
            },
          },
          // Style the text
          {
            updateTextStyle: {
              objectId: elementId,
              style: {
                fontFamily: font_family,
                fontSize: { magnitude: font_size, unit: "PT" },
                bold,
                italic,
                foregroundColor: {
                  opaqueColor: { rgbColor: hexToRgb(color) },
                },
              },
              fields: "fontFamily,fontSize,bold,italic,foregroundColor",
              textRange: { type: "ALL" },
            },
          },
          // Set paragraph alignment
          {
            updateParagraphStyle: {
              objectId: elementId,
              style: { alignment },
              fields: "alignment",
              textRange: { type: "ALL" },
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
   * add_image - Add an image to a slide from a URL
   */
  server.tool(
    "add_image",
    "Add an image to a slide from a URL. If only width OR height is specified, aspect ratio is preserved. Use alignment for quick positioning.",
    {
      presentation_id: z.string().describe("The presentation ID"),
      slide_id: z.string().describe("The slide to add the image to"),
      image_url: z.string().describe("URL of the image (must be publicly accessible)"),
      x: z.number().optional().describe("X position in inches"),
      y: z.number().optional().describe("Y position in inches"),
      width: z.number().optional().describe("Width in inches"),
      height: z.number().optional().describe("Height in inches"),
      horizontal_align: z.enum(["left", "center", "right"]).optional().describe("Horizontal alignment on slide"),
      vertical_align: z.enum(["top", "center", "bottom"]).optional().describe("Vertical alignment on slide"),
    },
    async ({ presentation_id, slide_id, image_url, x, y, width, height, horizontal_align, vertical_align }) => {
      try {
        const elementId = generateId("image");

        // Default size if not specified
        const imgWidth = width ?? 4.0;
        const imgHeight = height ?? 3.0;

        // Calculate position
        const slideSize = SLIDE_SIZES["16:9"];
        let posX: number;
        let posY: number;

        if (horizontal_align !== undefined || vertical_align !== undefined) {
          const [alignX, alignY] = calculateAlignmentPosition(
            slideSize,
            inchesToEmu(imgWidth),
            inchesToEmu(imgHeight),
            horizontal_align,
            vertical_align
          );
          posX = alignX;
          posY = alignY;
        } else {
          posX = inchesToEmu(x ?? 1.0);
          posY = inchesToEmu(y ?? 1.0);
        }

        const request = {
          createImage: {
            objectId: elementId,
            url: image_url,
            elementProperties: {
              pageObjectId: slide_id,
              size: {
                width: { magnitude: inchesToEmu(imgWidth), unit: "EMU" },
                height: { magnitude: inchesToEmu(imgHeight), unit: "EMU" },
              },
              transform: {
                scaleX: 1,
                scaleY: 1,
                shearX: 0,
                shearY: 0,
                translateX: posX,
                translateY: posY,
                unit: "EMU",
              },
            },
          },
        };

        await client.batchUpdate(presentation_id, [request]);

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
   * add_shape - Add a shape to a slide
   */
  server.tool(
    "add_shape",
    "Add a shape to a slide.",
    {
      presentation_id: z.string().describe("The presentation ID"),
      slide_id: z.string().describe("The slide to add the shape to"),
      shape_type: z.string().describe("Shape type (RECTANGLE, ELLIPSE, TRIANGLE, STAR_5, etc.)"),
      x: z.number().describe("X position in inches"),
      y: z.number().describe("Y position in inches"),
      width: z.number().describe("Width in inches"),
      height: z.number().describe("Height in inches"),
      fill_color: z.string().optional().describe("Fill color as hex (null for no fill)"),
      outline_color: z.string().default("#000000").optional().describe("Outline color as hex"),
      outline_weight: z.number().default(1).describe("Outline weight in points"),
    },
    async ({ presentation_id, slide_id, shape_type, x, y, width, height, fill_color, outline_color, outline_weight }) => {
      try {
        const elementId = generateId("shape");

        const requests: Record<string, unknown>[] = [
          {
            createShape: {
              objectId: elementId,
              shapeType: shape_type,
              elementProperties: {
                pageObjectId: slide_id,
                size: {
                  width: { magnitude: inchesToEmu(width), unit: "EMU" },
                  height: { magnitude: inchesToEmu(height), unit: "EMU" },
                },
                transform: {
                  scaleX: 1,
                  scaleY: 1,
                  shearX: 0,
                  shearY: 0,
                  translateX: inchesToEmu(x),
                  translateY: inchesToEmu(y),
                  unit: "EMU",
                },
              },
            },
          },
        ];

        // Build shape properties update
        const shapeProps: Record<string, unknown> = {};
        const fields: string[] = [];

        if (fill_color) {
          shapeProps.shapeBackgroundFill = {
            solidFill: { color: { rgbColor: hexToRgb(fill_color) } },
          };
          fields.push("shapeBackgroundFill");
        }

        if (outline_color) {
          shapeProps.outline = {
            outlineFill: {
              solidFill: { color: { rgbColor: hexToRgb(outline_color) } },
            },
            weight: { magnitude: outline_weight, unit: "PT" },
          };
          fields.push("outline");
        }

        if (fields.length > 0) {
          requests.push({
            updateShapeProperties: {
              objectId: elementId,
              shapeProperties: shapeProps,
              fields: fields.join(","),
            },
          });
        }

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
