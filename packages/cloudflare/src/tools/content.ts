/**
 * Content update tools for semantic text and styling operations.
 *
 * Tools for updating slide content by placeholder type and applying
 * consistent styling across presentations.
 */

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { SlidesClient } from "../api/slides-client.js";
import type { Props } from "../types.js";
import type { Page } from "../api/types.js";
import { hexToRgb } from "../utils/colors.js";

interface PlaceholderElement {
  object_id: string;
  placeholder_type: string;
  current_text: string;
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
 * Build deleteText + insertText pair for complete text replacement.
 */
function buildTextReplacementRequests(objectId: string, newText: string): Record<string, unknown>[] {
  return [
    { deleteText: { objectId, textRange: { type: "ALL" } } },
    { insertText: { objectId, text: newText, insertionIndex: 0 } },
  ];
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
      style: { alignment },
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
  _env: Env,
  props: Props
): void {
  const client = new SlidesClient({ accessToken: props.accessToken });

  /**
   * update_slide_content - Update slide text by placeholder type
   */
  server.tool(
    "update_slide_content",
    "Update slide text by placeholder type (TITLE, SUBTITLE, BODY). No element IDs needed - automatically finds placeholders and replaces text.",
    {
      presentation_id: z.string().describe("The presentation ID"),
      slide_id: z.string().describe("The slide to update"),
      content: z.record(z.union([z.string(), z.array(z.string())])).describe("Dict mapping placeholder types to new text"),
    },
    async ({ presentation_id, slide_id, content }) => {
      try {
        const slide = await client.getPage(presentation_id, slide_id);

        const requests: Record<string, unknown>[] = [];
        const updated: Record<string, boolean> = {};
        const notFound: string[] = [];

        for (const [placeholderType, newTextInput] of Object.entries(content)) {
          // Handle list content (join with newlines)
          const newText = Array.isArray(newTextInput)
            ? newTextInput.join("\n")
            : String(newTextInput);

          // Find matching placeholders
          const elements = findPlaceholderElements(slide, placeholderType);

          if (elements.length > 0) {
            for (const element of elements) {
              requests.push(...buildTextReplacementRequests(element.object_id, newText));
            }
            updated[placeholderType] = true;
          } else {
            notFound.push(placeholderType);
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
    "Update text across multiple slides in one call. More efficient than calling update_slide_content multiple times.",
    {
      presentation_id: z.string().describe("The presentation ID"),
      slides: z.array(z.record(z.unknown())).describe("List of dicts with slide_id and placeholder content"),
    },
    async ({ presentation_id, slides }) => {
      try {
        const presentation = await client.getPresentation(presentation_id);

        // Build a map of slide_id to slide data
        const slideMap = new Map<string, Page>();
        for (const slide of presentation.slides ?? []) {
          slideMap.set(slide.objectId ?? "", slide);
        }

        const requests: Record<string, unknown>[] = [];
        let slidesUpdated = 0;
        let placeholdersUpdated = 0;
        const errors: string[] = [];

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

          for (const [key, newTextInput] of Object.entries(slideSpec)) {
            if (key === "slide_id") continue;

            // Handle list content
            const newText = Array.isArray(newTextInput)
              ? newTextInput.join("\n")
              : String(newTextInput);

            // Find matching placeholders
            const elements = findPlaceholderElements(slide, key);

            for (const element of elements) {
              requests.push(...buildTextReplacementRequests(element.object_id, newText));
              placeholdersUpdated++;
              slideHadUpdates = true;
            }
          }

          if (slideHadUpdates) {
            slidesUpdated++;
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
        const presentation = await client.getPresentation(presentation_id);

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
