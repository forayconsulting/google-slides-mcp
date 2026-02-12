/**
 * Utility tools for inspecting and managing presentations.
 *
 * Tools for listing slides, getting element information, and exporting thumbnails.
 */

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { SlidesClient } from "../api/slides-client.js";
import type { TokenManager } from "../api/token-manager.js";
import type { Page } from "../api/types.js";
import { extractElementBounds } from "../utils/transforms.js";
import { emuToInches } from "../utils/units.js";

/**
 * Parse all elements on a slide page into a structured array with optional table data.
 * Returns { elements, warnings } for use by inspect_slide and inspect_slides.
 */
function parseSlideElements(
  slide: Page,
  includeTableData: boolean = false
): { elements: Record<string, unknown>[]; warnings: Record<string, unknown>[] } {
  const elements: Record<string, unknown>[] = [];
  const warnings: Record<string, unknown>[] = [];

  for (const pageElement of slide.pageElements ?? []) {
    const elementId = pageElement.objectId ?? "";
    const entry: Record<string, unknown> = { id: elementId };

    // Extract position and size
    if (pageElement.size && pageElement.transform) {
      const bounds = extractElementBounds(pageElement);
      entry.position = {
        x: Math.round(emuToInches(bounds.x) * 100) / 100,
        y: Math.round(emuToInches(bounds.y) * 100) / 100,
      };
      entry.size = {
        width: Math.round(emuToInches(bounds.width) * 100) / 100,
        height: Math.round(emuToInches(bounds.height) * 100) / 100,
      };
    }

    if (pageElement.shape) {
      const shape = pageElement.shape as unknown as Record<string, unknown>;
      entry.type = "SHAPE";
      entry.shape_type = (shape.shapeType as string) ?? "UNKNOWN";

      // Placeholder
      const placeholder = shape.placeholder as Record<string, unknown> | undefined;
      if (placeholder?.type) {
        entry.placeholder_type = placeholder.type;
      }

      // Text content and formatting
      const text = shape.text as Record<string, unknown> | undefined;
      const textElements = (text?.textElements as Array<Record<string, unknown>>) ?? [];

      let textContent = "";
      let firstRunStyle: Record<string, unknown> | null = null;

      for (const textElem of textElements) {
        const textRun = textElem.textRun as Record<string, unknown> | undefined;
        if (textRun) {
          textContent += (textRun.content as string) ?? "";
          if (!firstRunStyle) {
            firstRunStyle = (textRun.style as Record<string, unknown>) ?? null;
          }
        }
      }

      const trimmedText = textContent.trim();
      if (trimmedText) {
        entry.text = trimmedText;
      }

      // Extract formatting from first text run
      if (firstRunStyle) {
        const formatting: Record<string, unknown> = {};
        if (firstRunStyle.fontFamily) formatting.font_family = firstRunStyle.fontFamily;

        const fontSize = firstRunStyle.fontSize as Record<string, unknown> | undefined;
        if (fontSize?.magnitude) formatting.font_size_pt = fontSize.magnitude;

        if (firstRunStyle.bold) formatting.bold = true;
        if (firstRunStyle.italic) formatting.italic = true;

        const fgColor = firstRunStyle.foregroundColor as Record<string, unknown> | undefined;
        const opaqueColor = fgColor?.opaqueColor as Record<string, unknown> | undefined;
        const rgbColor = opaqueColor?.rgbColor as Record<string, unknown> | undefined;
        if (rgbColor) {
          const r = Math.round(((rgbColor.red as number) ?? 0) * 255);
          const g = Math.round(((rgbColor.green as number) ?? 0) * 255);
          const b = Math.round(((rgbColor.blue as number) ?? 0) * 255);
          formatting.color = `#${r.toString(16).padStart(2, "0")}${g.toString(16).padStart(2, "0")}${b.toString(16).padStart(2, "0")}`;
        }

        if (Object.keys(formatting).length > 0) {
          entry.formatting = formatting;
        }
      }

      // Overflow heuristic
      const sizeObj = entry.size as { width: number; height: number } | undefined;
      if (sizeObj && trimmedText) {
        const fontSizePt = (firstRunStyle?.fontSize as Record<string, unknown>)?.magnitude as number | undefined ?? 12;
        const charWidthInches = fontSizePt * 0.5 / 72;
        const charsPerLine = Math.max(1, Math.floor(sizeObj.width / charWidthInches));
        const textLines = trimmedText.split("\n").length;
        const estimatedLines = Math.max(textLines, Math.ceil(trimmedText.length / charsPerLine));
        const textHeightInches = estimatedLines * fontSizePt * 1.3 / 72;

        if (textHeightInches > sizeObj.height * 1.1) {
          warnings.push({
            element_id: elementId,
            type: "possible_overflow",
            message: `Text (~${trimmedText.length} chars) may overflow shape (${sizeObj.width}" x ${sizeObj.height}") at ${fontSizePt}pt`,
          });
        }
      }

      // Empty placeholder warning
      if (placeholder?.type && !trimmedText) {
        warnings.push({
          element_id: elementId,
          type: "empty_text",
          message: `${placeholder.type as string} placeholder has no content — may be a leftover placeholder`,
        });
      }
    } else if (pageElement.image) {
      entry.type = "IMAGE";
      const image = pageElement.image as unknown as Record<string, unknown>;
      entry.source_url = image.sourceUrl ?? "";
    } else if (pageElement.table) {
      entry.type = "TABLE";
      const table = pageElement.table as unknown as Record<string, unknown>;
      entry.rows = table.rows ?? 0;
      entry.columns = table.columns ?? 0;

      // Calculate actual table width from column widths (more accurate than element size)
      const tableColumns = table.tableColumns as Array<Record<string, unknown>> | undefined;
      if (tableColumns) {
        let totalWidth = 0;
        for (const col of tableColumns) {
          const colWidth = col.columnWidth as Record<string, unknown> | undefined;
          if (colWidth?.magnitude) {
            totalWidth += colWidth.magnitude as number;
          }
        }
        if (totalWidth > 0) {
          const currentSize = entry.size as Record<string, unknown> | undefined;
          entry.size = {
            width: Math.round(emuToInches(totalWidth) * 100) / 100,
            height: currentSize?.height ?? null,
          };
        }
      }

      // Include cell text data when requested
      if (includeTableData) {
        const tableRows = table.tableRows as Array<Record<string, unknown>> | undefined;
        if (tableRows) {
          const cells: string[][] = [];
          for (const row of tableRows) {
            const rowCells: string[] = [];
            const tableCells = row.tableCells as Array<Record<string, unknown>> | undefined;
            for (const cell of tableCells ?? []) {
              const cellText = cell.text as Record<string, unknown> | undefined;
              const cellTextElements = (cellText?.textElements as Array<Record<string, unknown>>) ?? [];
              let cellContent = "";
              for (const te of cellTextElements) {
                const tr = te.textRun as Record<string, unknown> | undefined;
                cellContent += (tr?.content as string) ?? "";
              }
              rowCells.push(cellContent.trim());
            }
            cells.push(rowCells);
          }
          entry.cells = cells;
        }
      }
    } else if (pageElement.line) {
      entry.type = "LINE";
      const line = pageElement.line as unknown as Record<string, unknown>;
      entry.line_type = line.lineType ?? "UNKNOWN";
    } else if ((pageElement as unknown as Record<string, unknown>).video) {
      entry.type = "VIDEO";
    } else {
      entry.type = "UNKNOWN";
    }

    elements.push(entry);
  }

  return { elements, warnings };
}

/**
 * Register utility tools with the MCP server.
 */
export function registerUtilityTools(
  server: McpServer,
  tokenManager: TokenManager
): void {
  const client = new SlidesClient(tokenManager);

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
        const presentation = await client.getPresentation(
          presentation_id,
          "slides(objectId,pageElements(objectId,shape(shapeType,placeholder,text)))"
        );

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
        const presentation = await client.getPresentation(
          presentation_id,
          "slides(objectId,pageElements)"
        );

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
   * list_layouts - List all available slide layouts in a presentation
   */
  server.tool(
    "list_layouts",
    "List all available slide layouts in a presentation with their IDs, names, and placeholder types. Useful for PPTX-converted presentations where predefined layout names may not work.",
    {
      presentation_id: z.string().describe("The presentation to list layouts from"),
    },
    async ({ presentation_id }) => {
      try {
        const presentation = await client.getPresentation(
          presentation_id,
          "layouts(objectId,layoutProperties,pageElements.shape.placeholder)"
        );

        const layoutsInfo = (presentation.layouts ?? []).map((layout) => {
          const layoutId = layout.objectId ?? "";
          const props = (layout as unknown as Record<string, unknown>).layoutProperties as
            | Record<string, unknown>
            | undefined;
          const name = (props?.name as string) ?? "";
          const displayName = (props?.displayName as string) ?? "";

          // Collect placeholder types
          const placeholderTypes: string[] = [];
          for (const element of layout.pageElements ?? []) {
            const pType = element.shape?.placeholder?.type;
            if (pType) {
              placeholderTypes.push(pType);
            }
          }

          return {
            layout_id: layoutId,
            name,
            display_name: displayName,
            placeholder_types: placeholderTypes,
          };
        });

        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify(layoutsInfo, null, 2),
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
   * inspect_slide - Comprehensive audit of all elements on a slide
   */
  server.tool(
    "inspect_slide",
    `Inspect all elements on a slide with positions, sizes, text, and formatting. Returns warnings for potential issues (text overflow, empty placeholders).

IMPORTANT: ALWAYS run this after creating or modifying a slide. Do not skip this step.
- BEFORE: Understand the slide's visual structure, element positions, and existing formatting
- AFTER: Verify your changes look correct and no warnings are present

CRITICAL: Overflow warnings mean the slide is BROKEN — text is visually cut off or colliding with other elements. You MUST fix every overflow warning before proceeding. Options: reduce font size, expand the shape, or shorten the text. NEVER dismiss overflow with "autofit should handle this."
For TABLE elements, set include_table_data=true to get a cells[][] array with all cell text.
To inspect multiple slides at once, use inspect_slides instead (single API call).`,
    {
      presentation_id: z.string().describe("The presentation ID"),
      slide_id: z.string().describe("The slide to inspect"),
      include_table_data: z.boolean().default(false).describe("When true, TABLE elements include a cells[][] field with all cell text"),
    },
    async ({ presentation_id, slide_id, include_table_data }) => {
      try {
        const slide = await client.getPage(presentation_id, slide_id);
        const { elements, warnings } = parseSlideElements(slide, include_table_data);

        const result: Record<string, unknown> = {
          slide_id,
          element_count: elements.length,
          elements,
        };
        if (warnings.length > 0) {
          result.warnings = warnings;
        }

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
   * inspect_slides - Inspect multiple slides in a single API call
   */
  server.tool(
    "inspect_slides",
    `Inspect multiple slides in one call. Returns per-slide element details, positions, text, formatting, and warnings — same output as inspect_slide but batched. Fetches the entire presentation once with a field mask, so this is much more efficient than calling inspect_slide in a loop.

If slide_ids is omitted, inspects ALL slides. Use include_table_data=true to get cell text for TABLE elements.`,
    {
      presentation_id: z.string().describe("The presentation ID"),
      slide_ids: z.array(z.string()).optional().describe("Slide IDs to inspect (omit for all slides)"),
      include_table_data: z.boolean().default(false).describe("When true, TABLE elements include a cells[][] field with all cell text"),
    },
    async ({ presentation_id, slide_ids, include_table_data }) => {
      try {
        const presentation = await client.getPresentation(
          presentation_id,
          "slides(objectId,pageElements)"
        );

        const slides = presentation.slides ?? [];
        const targetSlides = slide_ids
          ? slides.filter((s) => slide_ids.includes(s.objectId))
          : slides;

        const results: Record<string, unknown>[] = [];
        for (const slide of targetSlides) {
          const { elements, warnings } = parseSlideElements(slide, include_table_data);
          const entry: Record<string, unknown> = {
            slide_id: slide.objectId,
            element_count: elements.length,
            elements,
          };
          if (warnings.length > 0) {
            entry.warnings = warnings;
          }
          results.push(entry);
        }

        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify({ slides: results, slide_count: results.length }, null, 2),
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
