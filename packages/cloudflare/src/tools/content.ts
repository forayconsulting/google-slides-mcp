/**
 * Content update tools for semantic text and styling operations.
 *
 * Tools for updating slide content by placeholder type and applying
 * consistent styling across presentations.
 */

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { SlidesClient } from "../api/slides-client.js";
import type { TokenManager } from "../api/token-manager.js";
import type { Page } from "../api/types.js";
import { hexToRgb } from "../utils/colors.js";
import { extractElementBounds } from "../utils/transforms.js";
import { emuToInches } from "../utils/units.js";
import {
  extractPresentationStyle,
} from "../utils/style.js";

/**
 * Unescape literal \n and \t sequences that LLMs sometimes double-escape
 * in tool call parameters.
 */
function unescapeText(text: string): string {
  return text.replace(/\\n/g, "\n").replace(/\\t/g, "\t");
}

interface PlaceholderElement {
  object_id: string;
  placeholder_type: string;
  current_text: string;
}

/**
 * Parse a placeholder key like "BODY_1" into { type: "BODY", index: 1 }
 * or "BODY" into { type: "BODY", index: undefined }.
 */
function parsePlaceholderKey(key: string): { type: string; index: number | undefined } {
  const match = key.match(/^(.+?)_(\d+)$/);
  if (match) {
    return { type: match[1], index: parseInt(match[2], 10) };
  }
  return { type: key, index: undefined };
}

/**
 * Get placeholder bounds in inches from a page element.
 */
function getPlaceholderBounds(
  slide: Page,
  objectId: string
): { id: string; x: number; y: number; width: number; height: number } | undefined {
  const element = slide.pageElements?.find((el) => el.objectId === objectId);
  if (!element?.size || !element?.transform) return undefined;
  const bounds = extractElementBounds(element);
  return {
    id: objectId,
    x: Math.round(emuToInches(bounds.x) * 100) / 100,
    y: Math.round(emuToInches(bounds.y) * 100) / 100,
    width: Math.round(emuToInches(bounds.width) * 100) / 100,
    height: Math.round(emuToInches(bounds.height) * 100) / 100,
  };
}

/**
 * Find all elements matching a placeholder type on a slide.
 */
function findPlaceholderElements(slide: Page, placeholderType: string): PlaceholderElement[] {
  const results: PlaceholderElement[] = [];
  for (const element of slide.pageElements ?? []) {
    const shape = element.shape;
    const placeholder = shape?.placeholder;
    if (placeholder?.type === placeholderType) {
      // Extract current text
      const textElements = shape?.text?.textElements ?? [];
      const currentText = textElements
        .map((te) => te.textRun?.content ?? "")
        .join("");
      results.push({
        object_id: element.objectId ?? "",
        placeholder_type: placeholderType,
        current_text: currentText.trim(),
      });
    }
  }
  return results;
}

/**
 * Build text replacement requests, conditionally skipping deleteText for empty placeholders
 * and optionally adding bullet formatting.
 */
function buildTextReplacementRequests(
  objectId: string,
  newText: string,
  currentText: string,
  addBullets: boolean = false
): Record<string, unknown>[] {
  const requests: Record<string, unknown>[] = [];
  if (currentText.length > 0) {
    requests.push({ deleteText: { objectId, textRange: { type: "ALL" } } });
  }
  requests.push({ insertText: { objectId, text: unescapeText(newText), insertionIndex: 0 } });
  if (addBullets) {
    requests.push({
      createParagraphBullets: {
        objectId,
        textRange: { type: "ALL" },
        bulletPreset: "BULLET_DISC_CIRCLE_SQUARE",
      },
    });
  }
  return requests;
}

/**
 * Build updateTextStyle request with only specified fields.
 */
function buildStyleRequest(
  objectId: string,
  fontSizePt?: number,
  bold?: boolean,
  italic?: boolean,
  fontFamily?: string,
  color?: string
): Record<string, unknown> | null {
  const style: Record<string, unknown> = {};
  const fields: string[] = [];

  if (fontSizePt !== undefined) {
    style.fontSize = { magnitude: fontSizePt, unit: "PT" };
    fields.push("fontSize");
  }
  if (bold !== undefined) {
    style.bold = bold;
    fields.push("bold");
  }
  if (italic !== undefined) {
    style.italic = italic;
    fields.push("italic");
  }
  if (fontFamily !== undefined) {
    style.fontFamily = fontFamily;
    fields.push("fontFamily");
  }
  if (color !== undefined) {
    style.foregroundColor = { opaqueColor: { rgbColor: hexToRgb(color) } };
    fields.push("foregroundColor");
  }

  if (fields.length === 0) return null;

  return {
    updateTextStyle: {
      objectId,
      style,
      fields: fields.join(","),
      textRange: { type: "ALL" },
    },
  };
}

/** Map user-facing alignment values to Google Slides API ParagraphStyle.Alignment enum. */
function toApiAlignment(alignment: string): string {
  switch (alignment) {
    case "LEFT": return "START";
    case "RIGHT": return "END";
    default: return alignment;
  }
}

/**
 * Build updateParagraphStyle request.
 */
function buildParagraphStyleRequest(
  objectId: string,
  alignment?: string
): Record<string, unknown> | null {
  if (!alignment) return null;

  return {
    updateParagraphStyle: {
      objectId,
      style: { alignment: toApiAlignment(alignment) },
      fields: "alignment",
      textRange: { type: "ALL" },
    },
  };
}

/**
 * Register content tools with the MCP server.
 */
export function registerContentTools(
  server: McpServer,
  tokenManager: TokenManager
): void {
  const client = new SlidesClient(tokenManager);

  /**
   * update_slide_content - Update slide text by placeholder type
   */
  server.tool(
    "update_slide_content",
    `Update slide text by placeholder type (TITLE, SUBTITLE, BODY). No element IDs needed - automatically finds placeholders and replaces text. Returns position/size of each updated placeholder in inches for spatial awareness.

For multi-column layouts with multiple BODY placeholders:
- BODY (string) → writes to first BODY placeholder only
- BODY_0, BODY_1, BODY_2 → writes to specific BODY placeholder by index
- BODY (array, multiple BODY placeholders) → distributes one item per BODY placeholder

NOTE: For multiple slides, PREFER update_presentation_content (single API call, more efficient).

IMPORTANT: Before using this tool, use inspect_slide to understand the slide's visual structure and existing formatting. If the source material does not explicitly specify content for a placeholder, ask the user rather than guessing.`,
    {
      presentation_id: z.string().describe("The presentation ID"),
      slide_id: z.string().describe("The slide to update"),
      content: z.record(z.union([z.string(), z.array(z.string())])).describe("Dict mapping placeholder types to new text. Use BODY_0, BODY_1 for multi-column layouts."),
    },
    async ({ presentation_id, slide_id, content }) => {
      try {
        const slide = await client.getPage(presentation_id, slide_id);

        const requests: Record<string, unknown>[] = [];
        const updated: Record<string, { id: string; x: number; y: number; width: number; height: number } | true> = {};
        const notFound: string[] = [];

        for (const [key, newTextInput] of Object.entries(content)) {
          const { type: placeholderType, index } = parsePlaceholderKey(key);
          const isArray = Array.isArray(newTextInput);
          const addBullets = isArray && placeholderType === "BODY";

          // Find matching placeholders
          const elements = findPlaceholderElements(slide, placeholderType);

          if (elements.length === 0) {
            notFound.push(key);
            continue;
          }

          if (index !== undefined) {
            // Indexed access: BODY_0, BODY_1, etc.
            if (index >= elements.length) {
              notFound.push(key);
              continue;
            }
            const element = elements[index];
            const newText = isArray ? (newTextInput as string[]).join("\n") : String(newTextInput);
            requests.push(...buildTextReplacementRequests(element.object_id, newText, element.current_text, addBullets));
            const bounds = getPlaceholderBounds(slide, element.object_id);
            updated[key] = bounds ?? true;
          } else if (isArray && elements.length > 1) {
            // Array value with multiple matching placeholders: distribute
            const items = newTextInput as string[];
            for (let i = 0; i < Math.min(items.length, elements.length); i++) {
              const element = elements[i];
              requests.push(...buildTextReplacementRequests(element.object_id, items[i], element.current_text, addBullets));
              const bounds = getPlaceholderBounds(slide, element.object_id);
              updated[`${placeholderType}_${i}`] = bounds ?? true;
            }
          } else {
            // String value or single placeholder: write to first only
            const newText = isArray ? (newTextInput as string[]).join("\n") : String(newTextInput);
            const element = elements[0];
            requests.push(...buildTextReplacementRequests(element.object_id, newText, element.current_text, addBullets));
            const bounds = getPlaceholderBounds(slide, element.object_id);
            updated[key] = bounds ?? true;
          }
        }

        // Execute all requests in one batch
        if (requests.length > 0) {
          await client.batchUpdate(presentation_id, requests);
        }

        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify({ updated, not_found: notFound }, null, 2),
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
   * update_presentation_content - Update text across multiple slides in one call
   */
  server.tool(
    "update_presentation_content",
    `Update text across multiple slides in one call. More efficient than calling update_slide_content multiple times. Returns placeholder bounds for spatial awareness.

Each item in the slides array should have a slide_id plus placeholder type keys:
  [{"slide_id": "p3", "TITLE": "Slide 1", "BODY": "Content"}, {"slide_id": "p4", "TITLE": "Slide 2"}]

For multi-column layouts: use BODY_0, BODY_1 for indexed access, or pass an array to distribute across BODY placeholders.

IMPORTANT: Before bulk-updating slides, use inspect_slide on at least one representative slide to understand the template's visual structure. Do not fabricate names, roles, dates, or data — ask the user for any information not explicitly provided in the source material.`,
    {
      presentation_id: z.string().describe("The presentation ID"),
      slides: z.array(z.record(z.unknown())).describe("List of dicts with slide_id and placeholder content"),
    },
    async ({ presentation_id, slides }) => {
      try {
        const presentation = await client.getPresentation(
          presentation_id,
          "slides(objectId,pageElements)"
        );

        // Build a map of slide_id to slide data
        const slideMap = new Map<string, Page>();
        for (const slide of presentation.slides ?? []) {
          slideMap.set(slide.objectId ?? "", slide);
        }

        const requests: Record<string, unknown>[] = [];
        let slidesUpdated = 0;
        let placeholdersUpdated = 0;
        const errors: string[] = [];
        const slidePlaceholders: Record<string, Record<string, unknown>> = {};

        for (const slideSpec of slides) {
          const slideId = slideSpec.slide_id as string | undefined;
          if (!slideId) {
            errors.push("Missing slide_id in slide specification");
            continue;
          }

          const slide = slideMap.get(slideId);
          if (!slide) {
            errors.push(`Slide ${slideId} not found in presentation`);
            continue;
          }

          let slideHadUpdates = false;
          const slideUpdated: Record<string, unknown> = {};

          // Support both flat {slide_id, TITLE: ...} and nested {slide_id, content: {TITLE: ...}}
          let entries = Object.entries(slideSpec).filter(([k]) => k !== "slide_id");
          if (entries.length === 1 && entries[0][0] === "content" && typeof entries[0][1] === "object" && entries[0][1] !== null && !Array.isArray(entries[0][1])) {
            entries = Object.entries(entries[0][1] as Record<string, unknown>);
          }

          for (const [key, newTextInput] of entries) {
            const { type: placeholderType, index } = parsePlaceholderKey(key);
            const isArray = Array.isArray(newTextInput);
            const addBullets = isArray && placeholderType === "BODY";

            // Find matching placeholders
            const elements = findPlaceholderElements(slide, placeholderType);

            if (elements.length === 0) continue;

            if (index !== undefined) {
              // Indexed access: BODY_0, BODY_1, etc.
              if (index < elements.length) {
                const element = elements[index];
                const newText = isArray ? (newTextInput as string[]).join("\n") : String(newTextInput);
                requests.push(...buildTextReplacementRequests(element.object_id, newText, element.current_text, addBullets));
                placeholdersUpdated++;
                slideHadUpdates = true;
                const bounds = getPlaceholderBounds(slide, element.object_id);
                if (bounds) slideUpdated[key] = bounds;
              }
            } else if (isArray && elements.length > 1) {
              // Array value with multiple matching placeholders: distribute
              const items = newTextInput as string[];
              for (let i = 0; i < Math.min(items.length, elements.length); i++) {
                const element = elements[i];
                requests.push(...buildTextReplacementRequests(element.object_id, items[i], element.current_text, addBullets));
                placeholdersUpdated++;
                slideHadUpdates = true;
                const bounds = getPlaceholderBounds(slide, element.object_id);
                if (bounds) slideUpdated[`${placeholderType}_${i}`] = bounds;
              }
            } else {
              // String value or single placeholder: write to first only
              const newText = isArray ? (newTextInput as string[]).join("\n") : String(newTextInput);
              const element = elements[0];
              requests.push(...buildTextReplacementRequests(element.object_id, newText, element.current_text, addBullets));
              placeholdersUpdated++;
              slideHadUpdates = true;
              const bounds = getPlaceholderBounds(slide, element.object_id);
              if (bounds) slideUpdated[key] = bounds;
            }
          }

          if (slideHadUpdates) {
            slidesUpdated++;
            slidePlaceholders[slideId] = slideUpdated;
          }
        }

        // Execute all requests in one batch
        if (requests.length > 0) {
          await client.batchUpdate(presentation_id, requests);
        }

        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify({
                slides_updated: slidesUpdated,
                placeholders_updated: placeholdersUpdated,
                slide_placeholders: slidePlaceholders,
                errors,
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
   * apply_text_style - Apply consistent styling to placeholder types across slides
   */
  server.tool(
    "apply_text_style",
    "Apply consistent styling to placeholder types across slides. Only specified style properties are changed; others are preserved.",
    {
      presentation_id: z.string().describe("The presentation ID"),
      placeholder_type: z.string().describe("The placeholder type to style (TITLE, SUBTITLE, BODY)"),
      slide_ids: z.array(z.string()).optional().describe("List of slide IDs to style, or null for all slides"),
      font_size_pt: z.number().optional().describe("Font size in points"),
      bold: z.boolean().optional().describe("Whether text should be bold"),
      italic: z.boolean().optional().describe("Whether text should be italic"),
      font_family: z.string().optional().describe("Font family name"),
      color: z.string().optional().describe("Hex color string"),
      alignment: z.string().optional().describe("Text alignment (LEFT, CENTER, RIGHT)"),
    },
    async ({ presentation_id, placeholder_type, slide_ids, font_size_pt, bold, italic, font_family, color, alignment }) => {
      try {
        const presentation = await client.getPresentation(
          presentation_id,
          "slides(objectId,pageElements)"
        );

        const requests: Record<string, unknown>[] = [];
        let elementsStyled = 0;
        const slidesAffected: string[] = [];

        for (const slide of presentation.slides ?? []) {
          const slideId = slide.objectId ?? "";

          // Skip if not in specified slides
          if (slide_ids && !slide_ids.includes(slideId)) {
            continue;
          }

          // Find matching placeholders
          const elements = findPlaceholderElements(slide, placeholder_type);

          if (elements.length > 0) {
            slidesAffected.push(slideId);

            for (const element of elements) {
              const objectId = element.object_id;

              // Build style request
              const styleReq = buildStyleRequest(
                objectId,
                font_size_pt,
                bold,
                italic,
                font_family,
                color
              );
              if (styleReq) {
                requests.push(styleReq);
              }

              // Build paragraph style request
              const paraReq = buildParagraphStyleRequest(objectId, alignment);
              if (paraReq) {
                requests.push(paraReq);
              }

              if (styleReq || paraReq) {
                elementsStyled++;
              }
            }
          }
        }

        // Execute all requests in one batch
        if (requests.length > 0) {
          await client.batchUpdate(presentation_id, requests);
        }

        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify({
                elements_styled: elementsStyled,
                slides_affected: slidesAffected,
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
   * update_table_content - Replace all cell text in a table
   */
  server.tool(
    "update_table_content",
    `Update table cell text in bulk. Provide a 2D data array (row-major) to replace cell contents. Optionally styles the header row with bold text and the presentation's primary theme color.

Use inspect_slide with include_table_data=true to read existing table content before updating.

FORMATTING TIPS:
- Bold the index/number column (01, 02, etc.) for scannability.
- For "label: value" cells, update_table_content applies uniform formatting. To bold labels and italicize values within the same cell, follow up with batch_update using updateTextStyle on specific character index ranges.
- Use \\u000b (soft return) for line breaks within the same bullet; use \\n for separate items.
- Ensure table_y + table_height <= 5.63" (slide boundary). If the table extends past the slide, rows will be invisible.
- Fill available vertical space — if content is sparse, increase font_size to avoid >25% dead space at the bottom of the slide.`,
    {
      presentation_id: z.string().describe("The presentation ID"),
      slide_id: z.string().describe("The slide containing the table"),
      table_id: z.string().describe("Element ID of the table to update"),
      data: z.array(z.array(z.string())).describe("2D array of cell text (row-major). Must match table dimensions."),
      style_header: z.boolean().default(true).describe("Bold + themed color for first row"),
      font_size: z.number().default(9).describe("Font size in points for body cells"),
      font_family: z.string().default("Nunito Sans").describe("Font family for all cells"),
    },
    async ({ presentation_id, slide_id, table_id, data, style_header, font_size, font_family }) => {
      try {
        // Fetch slide to read current table cell text
        const slide = await client.getPage(presentation_id, slide_id);
        const tableElement = slide.pageElements?.find((el) => el.objectId === table_id);
        if (!tableElement?.table) {
          throw new Error(`Element ${table_id} is not a table or was not found on slide ${slide_id}`);
        }

        const table = tableElement.table;
        const rowCount = table.rows;
        const colCount = table.columns;

        if (data.length !== rowCount) {
          throw new Error(`Data has ${data.length} rows but table has ${rowCount} rows`);
        }
        for (let r = 0; r < data.length; r++) {
          if (data[r].length !== colCount) {
            throw new Error(`Data row ${r} has ${data[r].length} columns but table has ${colCount} columns`);
          }
        }

        // Read current cell text to conditionally skip deleteText for empty cells
        const currentCellText: string[][] = [];
        for (const row of table.tableRows ?? []) {
          const rowTexts: string[] = [];
          for (const cell of row.tableCells ?? []) {
            const textElements = cell.text?.textElements ?? [];
            let cellContent = "";
            for (const te of textElements) {
              cellContent += te.textRun?.content ?? "";
            }
            rowTexts.push(cellContent.trim());
          }
          currentCellText.push(rowTexts);
        }

        const requests: Record<string, unknown>[] = [];

        // Extract theme style for header coloring
        let headerColor: string | undefined;
        if (style_header) {
          try {
            const pres = await client.getPresentation(
              presentation_id,
              "masters,slides.pageElements.shape.shapeProperties,slides.pageElements.shape.text.textElements.textRun.style"
            );
            const style = extractPresentationStyle(pres);
            headerColor = style.primary_color;
          } catch {
            headerColor = "#054950"; // Fallback to brand default
          }
        }

        for (let row = 0; row < rowCount; row++) {
          for (let col = 0; col < colCount; col++) {
            const currentText = currentCellText[row]?.[col] ?? "";
            const newText = unescapeText(data[row][col]);

            // Only delete if cell has existing content
            if (currentText.length > 0) {
              requests.push({
                deleteText: {
                  objectId: table_id,
                  cellLocation: { rowIndex: row, columnIndex: col },
                  textRange: { type: "ALL" },
                },
              });
            }

            if (newText) {
              requests.push({
                insertText: {
                  objectId: table_id,
                  cellLocation: { rowIndex: row, columnIndex: col },
                  text: newText,
                  insertionIndex: 0,
                },
              });
            }

            // Style cells — only if the cell will have text
            if (newText) {
              const isHeader = style_header && row === 0;
              const textStyle: Record<string, unknown> = {
                fontFamily: font_family,
                fontSize: { magnitude: isHeader ? font_size + 1 : font_size, unit: "PT" },
                bold: isHeader,
              };
              const fields = ["fontFamily", "fontSize", "bold"];

              if (isHeader && headerColor) {
                textStyle.foregroundColor = {
                  opaqueColor: { rgbColor: hexToRgb("#FFFFFF") },
                };
                fields.push("foregroundColor");
              }

              requests.push({
                updateTextStyle: {
                  objectId: table_id,
                  cellLocation: { rowIndex: row, columnIndex: col },
                  style: textStyle,
                  fields: fields.join(","),
                  textRange: { type: "ALL" },
                },
              });
            }

            // Header background
            const isHeader = style_header && row === 0;
            if (isHeader && headerColor) {
              requests.push({
                updateTableCellProperties: {
                  objectId: table_id,
                  tableRange: {
                    location: { rowIndex: row, columnIndex: col },
                    rowSpan: 1,
                    columnSpan: 1,
                  },
                  tableCellProperties: {
                    tableCellBackgroundFill: {
                      solidFill: {
                        color: { rgbColor: hexToRgb(headerColor) },
                      },
                    },
                  },
                  fields: "tableCellBackgroundFill",
                },
              });
            }
          }
        }

        if (requests.length > 0) {
          await client.batchUpdate(presentation_id, requests);
        }

        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify({
                table_id,
                rows_updated: rowCount,
                columns_updated: colCount,
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
   * replace_text_on_slide - Slide-scoped find-and-replace
   */
  server.tool(
    "replace_text_on_slide",
    `Find and replace text within a single slide. Unlike replace_placeholders (which is presentation-wide), this targets only one slide. Useful for slide-specific edits like updating a name, date, or label without affecting other slides.

For each text element on the slide, all occurrences of each search string are replaced. Example: replacing "Q1" with "Q2" in a shape containing "Q1 Results" produces "Q2 Results".

NOTE: This performs replaceAllText scoped to one slide. It preserves existing character-level formatting for the surrounding text. Unlike batch_update insertText (which strips formatting), this is safer for targeted string swaps in already-styled elements.`,
    {
      presentation_id: z.string().describe("The presentation ID"),
      slide_id: z.string().describe("The slide to search"),
      replacements: z.record(z.string()).describe("Mapping of old text → new text"),
    },
    async ({ presentation_id, slide_id, replacements }) => {
      try {
        const slide = await client.getPage(presentation_id, slide_id);
        const requests: Record<string, unknown>[] = [];
        const replacementCounts: Record<string, number> = {};
        const elementsModified: string[] = [];

        // Initialize counts
        for (const key of Object.keys(replacements)) {
          replacementCounts[key] = 0;
        }

        for (const element of slide.pageElements ?? []) {
          const elementId = element.objectId ?? "";

          // Extract full text from shape
          let fullText = "";
          if (element.shape?.text?.textElements) {
            for (const te of element.shape.text.textElements) {
              fullText += te.textRun?.content ?? "";
            }
          }

          if (!fullText) continue;

          // Apply all replacements to the full text
          let modifiedText = fullText;
          let elementWasModified = false;

          for (const [search, replace] of Object.entries(replacements)) {
            if (modifiedText.includes(search)) {
              // Count occurrences before replacing
              let count = 0;
              let idx = modifiedText.indexOf(search);
              while (idx !== -1) {
                count++;
                idx = modifiedText.indexOf(search, idx + search.length);
              }
              replacementCounts[search] += count;
              modifiedText = modifiedText.split(search).join(replace);
              elementWasModified = true;
            }
          }

          if (elementWasModified) {
            // Only delete if there was content
            if (fullText.length > 0) {
              requests.push({
                deleteText: {
                  objectId: elementId,
                  textRange: { type: "ALL" },
                },
              });
            }
            requests.push({
              insertText: {
                objectId: elementId,
                text: modifiedText,
                insertionIndex: 0,
              },
            });
            elementsModified.push(elementId);
          }
        }

        if (requests.length > 0) {
          await client.batchUpdate(presentation_id, requests);
        }

        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify({
                replacements_made: replacementCounts,
                elements_modified: elementsModified,
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
