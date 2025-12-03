/**
 * Semantic positioning tools for Google Slides.
 *
 * These tools abstract away EMU calculations and transform math, providing
 * intuitive positioning using inches and alignment keywords.
 */

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { SlidesClient } from "../api/slides-client.js";
import type { Props } from "../types.js";
import { inchesToEmu, emuToInches } from "../utils/units.js";
import {
  SLIDE_SIZES,
  buildAbsoluteTransform,
  calculateAlignmentPosition,
  extractElementBounds,
  type SlideSize,
} from "../utils/transforms.js";

/**
 * Register positioning tools with the MCP server.
 */
export function registerPositioningTools(
  server: McpServer,
  _env: Env,
  props: Props
): void {
  const client = new SlidesClient({ accessToken: props.accessToken });

  /**
   * position_element - Position and size an element using inches and alignment
   */
  server.tool(
    "position_element",
    "Position and size an element using inches and alignment. You can specify absolute coordinates OR alignment OR both. Alignment is relative to the slide boundaries.",
    {
      presentation_id: z.string().describe("The presentation containing the element"),
      element_id: z.string().describe("The page element to position"),
      x: z.number().optional().describe("X position in inches from left edge"),
      y: z.number().optional().describe("Y position in inches from top edge"),
      width: z.number().optional().describe("New width in inches (null to preserve current)"),
      height: z.number().optional().describe("New height in inches (null to preserve current)"),
      horizontal_align: z.enum(["left", "center", "right"]).optional().describe("Align relative to slide width"),
      vertical_align: z.enum(["top", "center", "bottom"]).optional().describe("Align relative to slide height"),
    },
    async ({ presentation_id, element_id, x, y, width, height, horizontal_align, vertical_align }) => {
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
          throw new Error(`Element ${element_id} not found in presentation`);
        }

        // Get current bounds
        const currentBounds = extractElementBounds(element as Parameters<typeof extractElementBounds>[0]);

        // Calculate new dimensions
        const newWidth = width !== undefined ? inchesToEmu(width) : currentBounds.width;
        const newHeight = height !== undefined ? inchesToEmu(height) : currentBounds.height;

        // Determine slide size
        let slideSize: SlideSize = SLIDE_SIZES["16:9"];
        const pageSize = presentation.pageSize;
        if (pageSize) {
          const slideSizeWidth = pageSize.width?.magnitude ?? 0;
          const slideSizeHeight = pageSize.height?.magnitude ?? 0;
          if (slideSizeWidth && slideSizeHeight) {
            slideSize = { widthEmu: slideSizeWidth, heightEmu: slideSizeHeight };
          }
        }

        // Calculate position
        let newX: number;
        let newY: number;

        if (horizontal_align !== undefined || vertical_align !== undefined) {
          [newX, newY] = calculateAlignmentPosition(
            slideSize,
            newWidth,
            newHeight,
            horizontal_align,
            vertical_align
          );
          // Override with explicit coordinates if provided
          if (x !== undefined) newX = inchesToEmu(x);
          if (y !== undefined) newY = inchesToEmu(y);
        } else {
          newX = x !== undefined ? inchesToEmu(x) : currentBounds.x;
          newY = y !== undefined ? inchesToEmu(y) : currentBounds.y;
        }

        // Build transform
        const transform = buildAbsoluteTransform(newX, newY);

        // Create update request
        const requests: Record<string, unknown>[] = [
          {
            updatePageElementTransform: {
              objectId: element_id,
              transform,
              applyMode: "ABSOLUTE",
            },
          },
        ];

        // Add size update if needed
        if (width !== undefined || height !== undefined) {
          requests[0] = {
            updatePageElementTransform: {
              objectId: element_id,
              transform: {
                scaleX: currentBounds.width ? newWidth / currentBounds.width : 1,
                scaleY: currentBounds.height ? newHeight / currentBounds.height : 1,
                shearX: 0,
                shearY: 0,
                translateX: newX,
                translateY: newY,
                unit: "EMU",
              },
              applyMode: "ABSOLUTE",
            },
          };
        }

        await client.batchUpdate(presentation_id, requests);

        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify({
                element_id,
                position: { x_inches: emuToInches(newX), y_inches: emuToInches(newY) },
                size: {
                  width_inches: emuToInches(newWidth),
                  height_inches: emuToInches(newHeight),
                },
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
   * distribute_elements - Distribute elements evenly across the slide
   */
  server.tool(
    "distribute_elements",
    "Distribute elements evenly across the slide.",
    {
      presentation_id: z.string().describe("The presentation ID"),
      element_ids: z.array(z.string()).describe("Elements to distribute (order matters)"),
      direction: z.enum(["horizontal", "vertical"]).describe("Distribution direction"),
      spacing: z.union([z.number(), z.literal("even")]).default("even").describe("Fixed spacing in inches or 'even' for equal distribution"),
    },
    async ({ presentation_id, element_ids, direction, spacing }) => {
      try {
        const presentation = await client.getPresentation(presentation_id);

        // Get slide size
        let slideSize: SlideSize = SLIDE_SIZES["16:9"];
        const pageSize = presentation.pageSize;
        if (pageSize) {
          const slideSizeWidth = pageSize.width?.magnitude ?? 0;
          const slideSizeHeight = pageSize.height?.magnitude ?? 0;
          if (slideSizeWidth && slideSizeHeight) {
            slideSize = { widthEmu: slideSizeWidth, heightEmu: slideSizeHeight };
          }
        }

        // Collect element info
        const elements: Array<{ id: string; x: number; y: number; width: number; height: number }> = [];
        for (const slide of presentation.slides ?? []) {
          for (const pageElement of slide.pageElements ?? []) {
            if (element_ids.includes(pageElement.objectId ?? "")) {
              const bounds = extractElementBounds(pageElement as unknown as Parameters<typeof extractElementBounds>[0]);
              elements.push({
                id: pageElement.objectId ?? "",
                x: bounds.x,
                y: bounds.y,
                width: bounds.width,
                height: bounds.height,
              });
            }
          }
        }

        // Sort by provided order
        const idOrder = new Map(element_ids.map((id, i) => [id, i]));
        elements.sort((a, b) => (idOrder.get(a.id) ?? 0) - (idOrder.get(b.id) ?? 0));

        if (elements.length < 2) {
          return {
            content: [{ type: "text" as const, text: JSON.stringify({ error: "Need at least 2 elements to distribute" }) }],
            isError: true,
          };
        }

        // Calculate positions
        const requests: Record<string, unknown>[] = [];
        const newPositions: Array<{ element_id: string; x_inches: number; y_inches: number }> = [];

        if (direction === "horizontal") {
          const totalElementWidth = elements.reduce((sum, e) => sum + e.width, 0);
          const gap = spacing === "even"
            ? (slideSize.widthEmu - totalElementWidth) / (elements.length + 1)
            : inchesToEmu(spacing as number);

          let currentX = Math.floor(gap);
          for (const elem of elements) {
            const transform = buildAbsoluteTransform(currentX, elem.y);
            requests.push({
              updatePageElementTransform: {
                objectId: elem.id,
                transform,
                applyMode: "ABSOLUTE",
              },
            });
            newPositions.push({
              element_id: elem.id,
              x_inches: emuToInches(currentX),
              y_inches: emuToInches(elem.y),
            });
            currentX += elem.width + Math.floor(gap);
          }
        } else {
          const totalElementHeight = elements.reduce((sum, e) => sum + e.height, 0);
          const gap = spacing === "even"
            ? (slideSize.heightEmu - totalElementHeight) / (elements.length + 1)
            : inchesToEmu(spacing as number);

          let currentY = Math.floor(gap);
          for (const elem of elements) {
            const transform = buildAbsoluteTransform(elem.x, currentY);
            requests.push({
              updatePageElementTransform: {
                objectId: elem.id,
                transform,
                applyMode: "ABSOLUTE",
              },
            });
            newPositions.push({
              element_id: elem.id,
              x_inches: emuToInches(elem.x),
              y_inches: emuToInches(currentY),
            });
            currentY += elem.height + Math.floor(gap);
          }
        }

        if (requests.length > 0) {
          await client.batchUpdate(presentation_id, requests);
        }

        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify({ elements: newPositions }, null, 2),
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
   * align_elements - Align multiple elements to each other or to the slide
   */
  server.tool(
    "align_elements",
    "Align multiple elements to each other or to the slide.",
    {
      presentation_id: z.string().describe("The presentation ID"),
      element_ids: z.array(z.string()).describe("Elements to align"),
      alignment: z.enum(["left", "center", "right", "top", "middle", "bottom"]).describe("Edge or center to align"),
      reference: z.enum(["first", "last", "slide"]).default("first").describe("What to align to"),
    },
    async ({ presentation_id, element_ids, alignment, reference }) => {
      try {
        const presentation = await client.getPresentation(presentation_id);

        // Get slide size
        let slideSize: SlideSize = SLIDE_SIZES["16:9"];
        const pageSize = presentation.pageSize;
        if (pageSize) {
          const slideSizeWidth = pageSize.width?.magnitude ?? 0;
          const slideSizeHeight = pageSize.height?.magnitude ?? 0;
          if (slideSizeWidth && slideSizeHeight) {
            slideSize = { widthEmu: slideSizeWidth, heightEmu: slideSizeHeight };
          }
        }

        // Collect element info (preserving order)
        const elements: Array<{ id: string; x: number; y: number; width: number; height: number }> = [];
        for (const elemId of element_ids) {
          for (const slide of presentation.slides ?? []) {
            for (const pageElement of slide.pageElements ?? []) {
              if (pageElement.objectId === elemId) {
                const bounds = extractElementBounds(pageElement as unknown as Parameters<typeof extractElementBounds>[0]);
                elements.push({
                  id: elemId,
                  x: bounds.x,
                  y: bounds.y,
                  width: bounds.width,
                  height: bounds.height,
                });
                break;
              }
            }
          }
        }

        if (elements.length < 1) {
          return {
            content: [{ type: "text" as const, text: JSON.stringify({ error: "No elements found" }) }],
            isError: true,
          };
        }

        // Determine reference element
        let refElem: { x: number; y: number; width: number; height: number };
        if (reference === "first") {
          refElem = elements[0];
        } else if (reference === "last") {
          refElem = elements[elements.length - 1];
        } else {
          refElem = { x: 0, y: 0, width: slideSize.widthEmu, height: slideSize.heightEmu };
        }

        // Calculate target positions
        const requests: Record<string, unknown>[] = [];
        const newPositions: Array<{ element_id: string; x_inches: number; y_inches: number }> = [];

        for (const elem of elements) {
          let newX = elem.x;
          let newY = elem.y;

          if (alignment === "left") {
            newX = refElem.x;
          } else if (alignment === "center") {
            const refCenter = refElem.x + Math.floor(refElem.width / 2);
            newX = refCenter - Math.floor(elem.width / 2);
          } else if (alignment === "right") {
            const refRight = refElem.x + refElem.width;
            newX = refRight - elem.width;
          } else if (alignment === "top") {
            newY = refElem.y;
          } else if (alignment === "middle") {
            const refMiddle = refElem.y + Math.floor(refElem.height / 2);
            newY = refMiddle - Math.floor(elem.height / 2);
          } else if (alignment === "bottom") {
            const refBottom = refElem.y + refElem.height;
            newY = refBottom - elem.height;
          }

          const transform = buildAbsoluteTransform(newX, newY);
          requests.push({
            updatePageElementTransform: {
              objectId: elem.id,
              transform,
              applyMode: "ABSOLUTE",
            },
          });
          newPositions.push({
            element_id: elem.id,
            x_inches: emuToInches(newX),
            y_inches: emuToInches(newY),
          });
        }

        if (requests.length > 0) {
          await client.batchUpdate(presentation_id, requests);
        }

        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify({ elements: newPositions }, null, 2),
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
