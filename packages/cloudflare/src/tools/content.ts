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

NOTE: For multiple slides, PREFER update_presentation_content (single API call, more efficient).`,
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

For multi-column layouts: use BODY_0, BODY_1 for indexed access, or pass an array to distribute across BODY placeholders.`,
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
}
