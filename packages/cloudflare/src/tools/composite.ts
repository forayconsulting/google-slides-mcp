/**
 * Composite slide-level tools for Google Slides.
 *
 * High-level tools that create entire slides with content in one call,
 * automatically reading and applying the presentation's template theme.
 */

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { SlidesClient } from "../api/slides-client.js";
import type { TokenManager } from "../api/token-manager.js";
import type { Page } from "../api/types.js";
import { inchesToEmu, emuToInches } from "../utils/units.js";
import { hexToRgb } from "../utils/colors.js";
import { extractElementBounds } from "../utils/transforms.js";
import {
  extractPresentationStyle,
  DEFAULT_STYLE,
  type PresentationStyle,
} from "../utils/style.js";

/** Field mask for style extraction — fetches master theme + layouts + slide elements for PPTX fallback. */
const STYLE_FIELDS =
  "masters,layouts.pageProperties,layouts.pageElements.shape.shapeProperties,layouts.pageElements.shape.text.textElements.textRun.style,layouts.pageElements.shape.placeholder,slides.pageElements.shape.shapeProperties,slides.pageElements.shape.text.textElements.textRun.style,slides.pageElements.shape.placeholder";

function generateId(prefix: string): string {
  return `${prefix}_${Math.random().toString(36).substring(2, 10)}`;
}

function unescapeText(text: string): string {
  return text.replace(/\\n/g, "\n").replace(/\\t/g, "\t");
}

/** Format large numbers with K/M/B suffixes. */
function formatValue(value: number): string {
  if (Math.abs(value) >= 1_000_000_000)
    return `${(value / 1_000_000_000).toFixed(1)}B`;
  if (Math.abs(value) >= 1_000_000)
    return `${(value / 1_000_000).toFixed(1)}M`;
  if (Math.abs(value) >= 10_000) return `${(value / 1_000).toFixed(1)}K`;
  if (Number.isInteger(value)) return value.toString();
  return value.toFixed(1);
}

/**
 * Find the best layout matching the desired type from available layouts.
 * For TITLE_ONLY: prefer a layout with TITLE placeholder but no BODY.
 * Falls back to any layout with TITLE, then the first layout.
 */
function findBestLayout(
  layouts: Page[],
  desiredType: "TITLE_ONLY" | "BLANK"
): string | undefined {
  if (!layouts || layouts.length === 0) return undefined;

  let titleOnly: string | undefined; // TITLE and zero other placeholders (best)
  let titleNoBody: string | undefined; // TITLE but no BODY/SUBTITLE; may have IMAGE
  let withTitle: string | undefined; // any layout with TITLE (fallback)

  for (const layout of layouts) {
    let hasTitle = false;
    let hasBody = false;
    let otherPlaceholderCount = 0;
    for (const el of layout.pageElements ?? []) {
      const pType = el.shape?.placeholder?.type;
      if (!pType) continue;
      if (pType === "TITLE" || pType === "CENTERED_TITLE") {
        hasTitle = true;
      } else if (pType === "BODY" || pType === "SUBTITLE") {
        hasBody = true;
      } else {
        otherPlaceholderCount++;
      }
    }
    if (desiredType === "TITLE_ONLY" && hasTitle && !hasBody && otherPlaceholderCount === 0) {
      titleOnly = layout.objectId;
      break; // Best possible match
    }
    if (desiredType === "TITLE_ONLY" && hasTitle && !hasBody && !titleNoBody) {
      titleNoBody = layout.objectId;
    }
    if (hasTitle && !withTitle) {
      withTitle = layout.objectId;
    }
  }

  if (desiredType === "BLANK") {
    // For BLANK, prefer a layout with no placeholders
    const blank = layouts.find(
      (l) => (l.pageElements ?? []).every((el) => !el.shape?.placeholder)
    );
    return blank?.objectId ?? layouts[0]?.objectId;
  }

  return titleOnly ?? titleNoBody ?? withTitle ?? layouts[0]?.objectId;
}

/** Content bounds representing the available area for content on a slide (in inches). */
interface ContentBounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

/**
 * Shared helper: create a TITLE_ONLY slide (or use existing) and find the title placeholder.
 * Falls back to discovering custom layouts when predefined TITLE_ONLY is not available
 * (common with PPTX-converted presentations).
 * Returns contentBounds: the available area below the title for content placement.
 */
async function setupSlide(
  client: SlidesClient,
  presentationId: string,
  slideId: string | undefined,
  title: string,
  subtitle?: string,
  backgroundColor?: string
): Promise<{ slideId: string; titlePlaceholderId?: string; subtitlePlaceholderId?: string; contentBounds: ContentBounds }> {
  let actualSlideId: string;

  if (slideId) {
    actualSlideId = slideId;
  } else {
    // Create a TITLE_ONLY slide, with fallback for PPTX-converted presentations
    actualSlideId = generateId("slide");
    try {
      await client.batchUpdate(presentationId, [
        {
          createSlide: {
            objectId: actualSlideId,
            slideLayoutReference: { predefinedLayout: "TITLE_ONLY" },
          },
        },
      ]);
    } catch {
      // Predefined layout not available — discover custom layouts
      const pres = await client.getPresentation(
        presentationId,
        "layouts(objectId,pageElements.shape.placeholder)"
      );
      const layoutId = findBestLayout(pres.layouts ?? [], "TITLE_ONLY");
      const slideLayoutReference = layoutId
        ? { layoutId }
        : {}; // Empty = use default layout
      await client.batchUpdate(presentationId, [
        {
          createSlide: {
            objectId: actualSlideId,
            slideLayoutReference,
          },
        },
      ]);
    }
  }

  // Get page to find placeholders
  const page: Page = await client.getPage(presentationId, actualSlideId);
  let titlePlaceholderId: string | undefined;
  let subtitlePlaceholderId: string | undefined;

  for (const element of page.pageElements ?? []) {
    const placeholder = element.shape?.placeholder;
    if (!placeholder) continue;
    if (placeholder.type === "TITLE" || placeholder.type === "CENTERED_TITLE") {
      titlePlaceholderId = element.objectId;
    } else if (placeholder.type === "SUBTITLE") {
      subtitlePlaceholderId = element.objectId;
    }
  }

  // Delete non-title/subtitle elements (IMAGE placeholders, BODY, decorative shapes)
  // These are slide-level copies of layout placeholders — layout/master decorations
  // (backgrounds, logos) are NOT in pageElements and won't be affected.
  const keepIds = new Set<string>();
  if (titlePlaceholderId) keepIds.add(titlePlaceholderId);
  if (subtitlePlaceholderId) keepIds.add(subtitlePlaceholderId);

  const deleteRequests: Record<string, unknown>[] = [];
  for (const element of page.pageElements ?? []) {
    if (element.objectId && !keepIds.has(element.objectId)) {
      deleteRequests.push({ deleteObject: { objectId: element.objectId } });
    }
  }

  // Set the title via placeholder (preserves template styling)
  const requests: Record<string, unknown>[] = [];

  if (titlePlaceholderId) {
    // Check if placeholder has existing text to delete
    const titleElement = page.pageElements?.find(
      (el) => el.objectId === titlePlaceholderId
    );
    const existingText = titleElement?.shape?.text?.textElements
      ?.filter((te) => te.textRun?.content)
      .map((te) => te.textRun!.content!)
      .join("");

    if (existingText && existingText.trim().length > 0) {
      requests.push({
        deleteText: {
          objectId: titlePlaceholderId,
          textRange: { type: "ALL" },
        },
      });
    }
    requests.push({
      insertText: {
        objectId: titlePlaceholderId,
        text: unescapeText(title),
        insertionIndex: 0,
      },
    });
  }

  if (subtitlePlaceholderId && subtitle) {
    const subtitleElement = page.pageElements?.find(
      (el) => el.objectId === subtitlePlaceholderId
    );
    const existingSubText = subtitleElement?.shape?.text?.textElements
      ?.filter((te) => te.textRun?.content)
      .map((te) => te.textRun!.content!)
      .join("");

    if (existingSubText && existingSubText.trim().length > 0) {
      requests.push({
        deleteText: {
          objectId: subtitlePlaceholderId,
          textRange: { type: "ALL" },
        },
      });
    }
    requests.push({
      insertText: {
        objectId: subtitlePlaceholderId,
        text: unescapeText(subtitle),
        insertionIndex: 0,
      },
    });
  }

  // Calculate content bounds: area below title for content placement
  // Default slide: 10" x 5.625" with 0.5" side margins and 0.3" bottom margin
  const slideW = 10;
  const slideH = 5.625;
  const marginX = 0.5;
  const marginBottom = 0.3;
  let contentY = 1.1; // default if no title found

  if (titlePlaceholderId) {
    const titleEl = page.pageElements?.find((el) => el.objectId === titlePlaceholderId);
    if (titleEl?.size && titleEl?.transform) {
      const bounds = extractElementBounds(titleEl);
      const titleBottom = emuToInches(bounds.y + bounds.height);
      contentY = Math.round((titleBottom + 0.1) * 100) / 100; // 0.1" gap below title
    }
  }

  // Add an opaque cover rectangle to mask layout-level decorations from PPTX templates.
  // Layout-level shapes (inherited from the template layout) cannot be deleted via the API,
  // so we cover them with a slide-level rectangle matching the background color.
  // Content created by callers (bars, tables, cards) is added AFTER this, so it sits on top.
  if (backgroundColor) {
    const coverId = generateId("cover");
    requests.push(
      {
        createShape: {
          objectId: coverId,
          shapeType: "RECTANGLE",
          elementProperties: {
            pageObjectId: actualSlideId,
            size: {
              width: { magnitude: inchesToEmu(slideW), unit: "EMU" },
              height: { magnitude: inchesToEmu(slideH - contentY), unit: "EMU" },
            },
            transform: {
              scaleX: 1,
              scaleY: 1,
              shearX: 0,
              shearY: 0,
              translateX: 0,
              translateY: inchesToEmu(contentY),
              unit: "EMU",
            },
          },
        },
      },
      {
        updateShapeProperties: {
          objectId: coverId,
          shapeProperties: {
            shapeBackgroundFill: {
              solidFill: { color: { rgbColor: hexToRgb(backgroundColor) } },
            },
            outline: { propertyState: "NOT_RENDERED" },
          },
          fields: "shapeBackgroundFill,outline",
        },
      }
    );
  }

  if (deleteRequests.length > 0 || requests.length > 0) {
    await client.batchUpdate(presentationId, [...deleteRequests, ...requests]);
  }

  // Auto-shrink long titles — separate call because some PPTX templates
  // have placeholder types that don't support autofit, and we don't want
  // a failure here to prevent the title text from being set.
  if (titlePlaceholderId) {
    try {
      await client.batchUpdate(presentationId, [{
        updateShapeProperties: {
          objectId: titlePlaceholderId,
          shapeProperties: {
            autofit: { autofitType: "TEXT_AUTOFIT" },
          },
          fields: "autofit.autofitType",
        },
      }]);
    } catch {
      // Silently skip — title will render with default sizing
    }
  }

  const contentBounds: ContentBounds = {
    x: marginX,
    y: contentY,
    width: slideW - marginX * 2,
    height: Math.round((slideH - contentY - marginBottom) * 100) / 100,
  };

  return { slideId: actualSlideId, titlePlaceholderId, subtitlePlaceholderId, contentBounds };
}

/**
 * Register composite tools with the MCP server.
 */
export function registerCompositeTools(
  server: McpServer,
  tokenManager: TokenManager
): void {
  const client = new SlidesClient(tokenManager);

  // ─── get_presentation_style ──────────────────────────────────────────

  server.tool(
    "get_presentation_style",
    "Extract the presentation's theme colors and fonts from its master page. Returns a compact style object with primary/accent colors, heading/body fonts, and text colors. Use this when you need theme colors for atomic tools.",
    {
      presentation_id: z.string().describe("The presentation ID"),
    },
    async ({ presentation_id }) => {
      try {
        const presentation = await client.getPresentation(
          presentation_id,
          STYLE_FIELDS
        );
        const style = extractPresentationStyle(presentation);

        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify(style, null, 2),
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

  // ─── create_table_slide ──────────────────────────────────────────────

  server.tool(
    "create_table_slide",
    "Create a complete themed table slide in one call. Automatically extracts and applies the presentation's theme colors to headers and zebra stripes. Best for: team rosters, deliverable lists, timeline/milestone tables, agenda breakdowns. Provide data as a 2D array where the first row is the header. Creates a TITLE_ONLY slide (or uses existing slide_id) and sets the title via template placeholder.",
    {
      presentation_id: z.string().describe("The presentation ID"),
      title: z.string().describe("Slide title"),
      data: z
        .array(z.array(z.string()))
        .describe("2D array — first row is header"),
      slide_id: z
        .string()
        .optional()
        .describe("Use existing slide instead of creating new"),
      subtitle: z.string().optional().describe("Subtitle text"),
      header_row: z
        .boolean()
        .default(true)
        .describe("Style first row as header"),
    },
    async ({ presentation_id, title, data, slide_id, subtitle, header_row }) => {
      try {
        // Validate data
        if (data.length === 0) {
          return {
            content: [
              { type: "text" as const, text: "Error: data must not be empty" },
            ],
            isError: true,
          };
        }
        const colCount = data[0].length;
        if (colCount === 0) {
          return {
            content: [
              {
                type: "text" as const,
                text: "Error: rows must have at least one column",
              },
            ],
            isError: true,
          };
        }
        for (let i = 0; i < data.length; i++) {
          if (data[i].length !== colCount) {
            return {
              content: [
                {
                  type: "text" as const,
                  text: `Error: row ${i} has ${data[i].length} columns, expected ${colCount}`,
                },
              ],
              isError: true,
            };
          }
        }

        // Extract style
        const presentation = await client.getPresentation(
          presentation_id,
          STYLE_FIELDS
        );
        const style = extractPresentationStyle(presentation);

        // Create/setup slide with title
        const { slideId: actualSlideId, contentBounds } = await setupSlide(
          client,
          presentation_id,
          slide_id,
          title,
          subtitle,
          style.background_color
        );

        // Table layout — positioned dynamically based on actual title height
        const tableX = contentBounds.x;
        const tableY = contentBounds.y;
        const tableW = contentBounds.width;
        const rowCount = data.length;
        const tableH = Math.min(contentBounds.height, Math.max(1.5, rowCount * 0.4));

        const tableId = generateId("table");

        // Create table
        await client.batchUpdate(presentation_id, [
          {
            createTable: {
              objectId: tableId,
              rows: rowCount,
              columns: colCount,
              elementProperties: {
                pageObjectId: actualSlideId,
                size: {
                  width: { magnitude: inchesToEmu(tableW), unit: "EMU" },
                  height: { magnitude: inchesToEmu(tableH), unit: "EMU" },
                },
                transform: {
                  scaleX: 1,
                  scaleY: 1,
                  shearX: 0,
                  shearY: 0,
                  translateX: inchesToEmu(tableX),
                  translateY: inchesToEmu(tableY),
                  unit: "EMU",
                },
              },
            },
          },
        ]);

        // Build cell styling requests
        const requests: Record<string, unknown>[] = [];

        for (let row = 0; row < rowCount; row++) {
          for (let col = 0; col < colCount; col++) {
            const cellText = unescapeText(data[row][col]);

            // Insert text
            if (cellText) {
              requests.push({
                insertText: {
                  objectId: tableId,
                  cellLocation: { rowIndex: row, columnIndex: col },
                  text: cellText,
                  insertionIndex: 0,
                },
              });
            }

            // Style text
            const isHeader = header_row && row === 0;
            const textColor = isHeader
              ? style.background_color
              : style.heading_text_color;
            requests.push({
              updateTextStyle: {
                objectId: tableId,
                cellLocation: { rowIndex: row, columnIndex: col },
                style: {
                  fontFamily: style.body_font,
                  fontSize: {
                    magnitude: isHeader ? 13 : 12,
                    unit: "PT",
                  },
                  bold: isHeader,
                  foregroundColor: {
                    opaqueColor: { rgbColor: hexToRgb(textColor) },
                  },
                },
                fields: "fontFamily,fontSize,bold,foregroundColor",
                textRange: { type: "ALL" },
              },
            });

            // Cell background
            let bgColor: string | undefined;
            if (isHeader) {
              bgColor = style.primary_color;
            } else if (row % 2 === 0) {
              bgColor = style.alt_background_color;
            }

            if (bgColor) {
              requests.push({
                updateTableCellProperties: {
                  objectId: tableId,
                  tableRange: {
                    location: { rowIndex: row, columnIndex: col },
                    rowSpan: 1,
                    columnSpan: 1,
                  },
                  tableCellProperties: {
                    tableCellBackgroundFill: {
                      solidFill: {
                        color: { rgbColor: hexToRgb(bgColor) },
                      },
                    },
                  },
                  fields: "tableCellBackgroundFill",
                },
              });
            }
          }
        }

        // Borders
        const borderRgb = hexToRgb(style.alt_background_color);
        const borderDef = {
          tableBorderFill: {
            solidFill: { color: { rgbColor: borderRgb } },
          },
          weight: { magnitude: 0.5, unit: "PT" },
          dashStyle: "SOLID",
        };

        for (let row = 0; row < rowCount; row++) {
          for (let col = 0; col < colCount; col++) {
            requests.push({
              updateTableBorderProperties: {
                objectId: tableId,
                tableRange: {
                  location: { rowIndex: row, columnIndex: col },
                  rowSpan: 1,
                  columnSpan: 1,
                },
                tableBorderProperties: borderDef,
                borderPosition: "ALL",
                fields: "tableBorderFill,weight,dashStyle",
              },
            });
          }
        }

        if (requests.length > 0) {
          await client.batchUpdate(presentation_id, requests);
        }

        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify(
                {
                  slide_id: actualSlideId,
                  table_id: tableId,
                  rows: rowCount,
                  columns: colCount,
                  style_source: style.source,
                },
                null,
                2
              ),
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

  // ─── create_chart_slide ──────────────────────────────────────────────

  server.tool(
    "create_chart_slide",
    "Create a complete bar chart slide in one call. Automatically applies the presentation's theme colors to bars, labels, and text. Creates a TITLE_ONLY slide (or uses existing slide_id), sets the title via template placeholder, and builds a themed bar chart.",
    {
      presentation_id: z.string().describe("The presentation ID"),
      title: z.string().describe("Slide title"),
      labels: z.array(z.string()).describe("Category labels"),
      values: z.array(z.number()).describe("Numeric values"),
      slide_id: z
        .string()
        .optional()
        .describe("Use existing slide instead of creating new"),
      chart_title: z
        .string()
        .optional()
        .describe("Title inside the chart area"),
      show_values: z
        .boolean()
        .default(true)
        .describe("Show value labels above bars"),
      multi_color: z
        .boolean()
        .default(false)
        .describe("Use ACCENT1-6 for different bars instead of single color"),
    },
    async ({
      presentation_id,
      title,
      labels,
      values,
      slide_id,
      chart_title,
      show_values,
      multi_color,
    }) => {
      try {
        // Validate
        if (labels.length !== values.length) {
          return {
            content: [
              {
                type: "text" as const,
                text: "Error: labels and values must have the same length",
              },
            ],
            isError: true,
          };
        }
        if (labels.length === 0) {
          return {
            content: [
              {
                type: "text" as const,
                text: "Error: must have at least one data point",
              },
            ],
            isError: true,
          };
        }
        const maxValue = Math.max(...values);
        if (maxValue <= 0) {
          return {
            content: [
              {
                type: "text" as const,
                text: "Error: at least one value must be positive",
              },
            ],
            isError: true,
          };
        }

        // Extract style
        const presentation = await client.getPresentation(
          presentation_id,
          STYLE_FIELDS
        );
        const style = extractPresentationStyle(presentation);

        // Create/setup slide with title
        const { slideId: actualSlideId, contentBounds } = await setupSlide(
          client,
          presentation_id,
          slide_id,
          title,
          undefined,
          style.background_color
        );

        // Build bar color list
        const allAccentColors = [
          style.primary_color,
          ...style.accent_colors,
        ];
        const barColors = labels.map((_, i) =>
          multi_color
            ? allAccentColors[i % allAccentColors.length]
            : style.primary_color
        );

        // Chart layout — positioned dynamically based on actual title height
        const chartX = contentBounds.x;
        const chartY = contentBounds.y;
        const chartW = contentBounds.width;
        const chartH = contentBounds.height;

        const chartTitleHeight = chart_title ? 0.5 : 0;
        const valueLabelHeight = show_values ? 0.35 : 0;
        const categoryLabelHeight = 0.35;
        const maxBarHeight =
          chartH - chartTitleHeight - valueLabelHeight - categoryLabelHeight;

        const barCount = labels.length;
        const gapRatio = 0.3;
        const barWidth =
          chartW / (barCount + (barCount + 1) * gapRatio);
        const gapWidth = barWidth * gapRatio;

        const requests: Record<string, unknown>[] = [];
        const elementIds: string[] = [];

        // Optional chart title
        if (chart_title) {
          const ctId = generateId("chtitle");
          elementIds.push(ctId);
          requests.push(
            {
              createShape: {
                objectId: ctId,
                shapeType: "TEXT_BOX",
                elementProperties: {
                  pageObjectId: actualSlideId,
                  size: {
                    width: { magnitude: inchesToEmu(chartW), unit: "EMU" },
                    height: {
                      magnitude: inchesToEmu(chartTitleHeight),
                      unit: "EMU",
                    },
                  },
                  transform: {
                    scaleX: 1,
                    scaleY: 1,
                    shearX: 0,
                    shearY: 0,
                    translateX: inchesToEmu(chartX),
                    translateY: inchesToEmu(chartY),
                    unit: "EMU",
                  },
                },
              },
            },
            {
              insertText: {
                objectId: ctId,
                text: unescapeText(chart_title),
                insertionIndex: 0,
              },
            },
            {
              updateTextStyle: {
                objectId: ctId,
                style: {
                  fontFamily: style.heading_font,
                  fontSize: { magnitude: 14, unit: "PT" },
                  bold: true,
                  foregroundColor: {
                    opaqueColor: {
                      rgbColor: hexToRgb(style.heading_text_color),
                    },
                  },
                },
                fields: "fontFamily,fontSize,bold,foregroundColor",
                textRange: { type: "ALL" },
              },
            },
            {
              updateParagraphStyle: {
                objectId: ctId,
                style: { alignment: "CENTER" },
                fields: "alignment",
                textRange: { type: "ALL" },
              },
            }
          );
        }

        // Draw bars + labels
        for (let i = 0; i < barCount; i++) {
          const barX = chartX + gapWidth + i * (barWidth + gapWidth);
          const barHeight = Math.max(
            (values[i] / maxValue) * maxBarHeight,
            0.02
          );
          const barY =
            chartY +
            chartTitleHeight +
            valueLabelHeight +
            (maxBarHeight - barHeight);

          // Bar rectangle
          const barId = generateId("bar");
          elementIds.push(barId);
          requests.push(
            {
              createShape: {
                objectId: barId,
                shapeType: "RECTANGLE",
                elementProperties: {
                  pageObjectId: actualSlideId,
                  size: {
                    width: { magnitude: inchesToEmu(barWidth), unit: "EMU" },
                    height: {
                      magnitude: inchesToEmu(barHeight),
                      unit: "EMU",
                    },
                  },
                  transform: {
                    scaleX: 1,
                    scaleY: 1,
                    shearX: 0,
                    shearY: 0,
                    translateX: inchesToEmu(barX),
                    translateY: inchesToEmu(barY),
                    unit: "EMU",
                  },
                },
              },
            },
            {
              updateShapeProperties: {
                objectId: barId,
                shapeProperties: {
                  shapeBackgroundFill: {
                    solidFill: {
                      color: { rgbColor: hexToRgb(barColors[i]) },
                    },
                  },
                  outline: { propertyState: "NOT_RENDERED" },
                },
                fields: "shapeBackgroundFill,outline",
              },
            }
          );

          // Value label above bar
          if (show_values) {
            const valId = generateId("val");
            elementIds.push(valId);
            const valLabelY = barY - valueLabelHeight;
            requests.push(
              {
                createShape: {
                  objectId: valId,
                  shapeType: "TEXT_BOX",
                  elementProperties: {
                    pageObjectId: actualSlideId,
                    size: {
                      width: {
                        magnitude: inchesToEmu(barWidth),
                        unit: "EMU",
                      },
                      height: {
                        magnitude: inchesToEmu(valueLabelHeight),
                        unit: "EMU",
                      },
                    },
                    transform: {
                      scaleX: 1,
                      scaleY: 1,
                      shearX: 0,
                      shearY: 0,
                      translateX: inchesToEmu(barX),
                      translateY: inchesToEmu(valLabelY),
                      unit: "EMU",
                    },
                  },
                },
              },
              {
                insertText: {
                  objectId: valId,
                  text: formatValue(values[i]),
                  insertionIndex: 0,
                },
              },
              {
                updateTextStyle: {
                  objectId: valId,
                  style: {
                    fontFamily: style.body_font,
                    fontSize: { magnitude: 10, unit: "PT" },
                    bold: true,
                    foregroundColor: {
                      opaqueColor: {
                        rgbColor: hexToRgb(style.body_text_color),
                      },
                    },
                  },
                  fields: "fontFamily,fontSize,bold,foregroundColor",
                  textRange: { type: "ALL" },
                },
              },
              {
                updateParagraphStyle: {
                  objectId: valId,
                  style: { alignment: "CENTER" },
                  fields: "alignment",
                  textRange: { type: "ALL" },
                },
              }
            );
          }

          // Category label below bar
          const catId = generateId("cat");
          elementIds.push(catId);
          const catLabelY =
            chartY + chartTitleHeight + valueLabelHeight + maxBarHeight;
          requests.push(
            {
              createShape: {
                objectId: catId,
                shapeType: "TEXT_BOX",
                elementProperties: {
                  pageObjectId: actualSlideId,
                  size: {
                    width: {
                      magnitude: inchesToEmu(barWidth + gapWidth),
                      unit: "EMU",
                    },
                    height: {
                      magnitude: inchesToEmu(categoryLabelHeight),
                      unit: "EMU",
                    },
                  },
                  transform: {
                    scaleX: 1,
                    scaleY: 1,
                    shearX: 0,
                    shearY: 0,
                    translateX: inchesToEmu(barX - gapWidth / 2),
                    translateY: inchesToEmu(catLabelY),
                    unit: "EMU",
                  },
                },
              },
            },
            {
              insertText: {
                objectId: catId,
                text: unescapeText(labels[i]),
                insertionIndex: 0,
              },
            },
            {
              updateTextStyle: {
                objectId: catId,
                style: {
                  fontFamily: style.body_font,
                  fontSize: { magnitude: 10, unit: "PT" },
                  foregroundColor: {
                    opaqueColor: {
                      rgbColor: hexToRgb(style.body_text_color),
                    },
                  },
                },
                fields: "fontFamily,fontSize,foregroundColor",
                textRange: { type: "ALL" },
              },
            },
            {
              updateParagraphStyle: {
                objectId: catId,
                style: { alignment: "CENTER" },
                fields: "alignment",
                textRange: { type: "ALL" },
              },
            }
          );
        }

        await client.batchUpdate(presentation_id, requests);

        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify(
                {
                  slide_id: actualSlideId,
                  element_ids: elementIds,
                  bar_count: barCount,
                  style_source: style.source,
                },
                null,
                2
              ),
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

  // ─── create_dashboard_slide ──────────────────────────────────────────

  server.tool(
    "create_dashboard_slide",
    "Create a KPI dashboard with 1-8 auto-arranged metric cards. Best for: current state snapshots, key metrics overviews, executive summaries. Each metric needs 'value' (the big number) and 'label' (what it measures), with optional 'description' (context like 'Up 25% YoY'). Automatically applies the presentation's theme colors. Creates a TITLE_ONLY slide (or uses existing slide_id) and sets the title via template placeholder.",
    {
      presentation_id: z.string().describe("The presentation ID"),
      title: z.string().describe("Slide title"),
      metrics: z
        .array(
          z.object({
            value: z.string().describe("Metric value (e.g., '3.5M', '99.9%')"),
            label: z.string().describe("Metric label (e.g., 'Active Users')"),
            description: z
              .string()
              .optional()
              .describe("Optional context (e.g., 'Up 25% YoY')"),
          })
        )
        .min(1)
        .max(8)
        .describe("1-8 metric cards"),
      slide_id: z
        .string()
        .optional()
        .describe("Use existing slide instead of creating new"),
      show_card_background: z
        .boolean()
        .default(true)
        .describe("Show card background rectangles"),
    },
    async ({
      presentation_id,
      title,
      metrics,
      slide_id,
      show_card_background,
    }) => {
      try {
        // Extract style
        const presentation = await client.getPresentation(
          presentation_id,
          STYLE_FIELDS
        );
        const style = extractPresentationStyle(presentation);

        // Create/setup slide with title
        const { slideId: actualSlideId, contentBounds } = await setupSlide(
          client,
          presentation_id,
          slide_id,
          title,
          undefined,
          style.background_color
        );

        // Grid layout calculation — positioned dynamically based on actual title height
        const contentX = contentBounds.x;
        const contentY = contentBounds.y;
        const contentW = contentBounds.width;
        const contentH = contentBounds.height;
        const gap = 0.25;

        const count = metrics.length;
        let cols: number;
        let rows: number;

        if (count <= 4) {
          rows = 1;
          cols = count;
        } else if (count <= 6) {
          rows = 2;
          cols = 3;
        } else {
          rows = 2;
          cols = 4;
        }

        const cardW = (contentW - gap * (cols - 1)) / cols;
        const cardH = (contentH - gap * (rows - 1)) / rows;

        // Scale font sizes based on count
        const statFontSize = count <= 4 ? 44 : count <= 6 ? 36 : 30;
        const labelFontSize = count <= 4 ? 14 : 12;
        const descFontSize = count <= 4 ? 11 : 10;

        const requests: Record<string, unknown>[] = [];
        const elementIds: string[] = [];

        for (let i = 0; i < count; i++) {
          const metric = metrics[i];
          const rowIdx = Math.floor(i / cols);
          const colIdx = i % cols;

          // Center last row if incomplete
          let rowOffset = 0;
          const isLastRow = rowIdx === rows - 1;
          const itemsInLastRow = count - (rows - 1) * cols;
          if (isLastRow && itemsInLastRow < cols) {
            rowOffset =
              ((cols - itemsInLastRow) * (cardW + gap)) / 2;
          }

          const cardX =
            contentX + rowOffset + colIdx * (cardW + gap);
          const cardY = contentY + rowIdx * (cardH + gap);

          // Background card
          if (show_card_background) {
            const bgId = generateId("cardbg");
            elementIds.push(bgId);
            requests.push(
              {
                createShape: {
                  objectId: bgId,
                  shapeType: "ROUND_RECTANGLE",
                  elementProperties: {
                    pageObjectId: actualSlideId,
                    size: {
                      width: {
                        magnitude: inchesToEmu(cardW),
                        unit: "EMU",
                      },
                      height: {
                        magnitude: inchesToEmu(cardH),
                        unit: "EMU",
                      },
                    },
                    transform: {
                      scaleX: 1,
                      scaleY: 1,
                      shearX: 0,
                      shearY: 0,
                      translateX: inchesToEmu(cardX),
                      translateY: inchesToEmu(cardY),
                      unit: "EMU",
                    },
                  },
                },
              },
              {
                updateShapeProperties: {
                  objectId: bgId,
                  shapeProperties: {
                    shapeBackgroundFill: {
                      solidFill: {
                        color: {
                          rgbColor: hexToRgb(style.alt_background_color),
                        },
                      },
                    },
                    outline: { propertyState: "NOT_RENDERED" },
                  },
                  fields: "shapeBackgroundFill,outline",
                },
              }
            );
          }

          // Layout within card
          const padding = 0.15;
          const innerW = cardW - padding * 2;
          const statH = cardH * 0.5;
          const labelH = cardH * 0.2;
          const descH = metric.description ? cardH * 0.2 : 0;

          // Stat value
          const statId = generateId("statval");
          elementIds.push(statId);
          requests.push(
            {
              createShape: {
                objectId: statId,
                shapeType: "TEXT_BOX",
                elementProperties: {
                  pageObjectId: actualSlideId,
                  size: {
                    width: {
                      magnitude: inchesToEmu(innerW),
                      unit: "EMU",
                    },
                    height: {
                      magnitude: inchesToEmu(statH),
                      unit: "EMU",
                    },
                  },
                  transform: {
                    scaleX: 1,
                    scaleY: 1,
                    shearX: 0,
                    shearY: 0,
                    translateX: inchesToEmu(cardX + padding),
                    translateY: inchesToEmu(cardY + padding),
                    unit: "EMU",
                  },
                },
              },
            },
            {
              insertText: {
                objectId: statId,
                text: unescapeText(metric.value),
                insertionIndex: 0,
              },
            },
            {
              updateTextStyle: {
                objectId: statId,
                style: {
                  fontFamily: style.heading_font,
                  fontSize: { magnitude: statFontSize, unit: "PT" },
                  bold: true,
                  foregroundColor: {
                    opaqueColor: {
                      rgbColor: hexToRgb(style.primary_color),
                    },
                  },
                },
                fields: "fontFamily,fontSize,bold,foregroundColor",
                textRange: { type: "ALL" },
              },
            },
            {
              updateParagraphStyle: {
                objectId: statId,
                style: { alignment: "CENTER" },
                fields: "alignment",
                textRange: { type: "ALL" },
              },
            }
          );

          // Label
          const lblId = generateId("statlbl");
          elementIds.push(lblId);
          const labelY = cardY + padding + statH;
          requests.push(
            {
              createShape: {
                objectId: lblId,
                shapeType: "TEXT_BOX",
                elementProperties: {
                  pageObjectId: actualSlideId,
                  size: {
                    width: {
                      magnitude: inchesToEmu(innerW),
                      unit: "EMU",
                    },
                    height: {
                      magnitude: inchesToEmu(labelH),
                      unit: "EMU",
                    },
                  },
                  transform: {
                    scaleX: 1,
                    scaleY: 1,
                    shearX: 0,
                    shearY: 0,
                    translateX: inchesToEmu(cardX + padding),
                    translateY: inchesToEmu(labelY),
                    unit: "EMU",
                  },
                },
              },
            },
            {
              insertText: {
                objectId: lblId,
                text: unescapeText(metric.label),
                insertionIndex: 0,
              },
            },
            {
              updateTextStyle: {
                objectId: lblId,
                style: {
                  fontFamily: style.body_font,
                  fontSize: { magnitude: labelFontSize, unit: "PT" },
                  foregroundColor: {
                    opaqueColor: {
                      rgbColor: hexToRgb(style.body_text_color),
                    },
                  },
                },
                fields: "fontFamily,fontSize,foregroundColor",
                textRange: { type: "ALL" },
              },
            },
            {
              updateParagraphStyle: {
                objectId: lblId,
                style: { alignment: "CENTER" },
                fields: "alignment",
                textRange: { type: "ALL" },
              },
            }
          );

          // Optional description
          if (metric.description) {
            const descId = generateId("statdsc");
            elementIds.push(descId);
            const descY = labelY + labelH;
            requests.push(
              {
                createShape: {
                  objectId: descId,
                  shapeType: "TEXT_BOX",
                  elementProperties: {
                    pageObjectId: actualSlideId,
                    size: {
                      width: {
                        magnitude: inchesToEmu(innerW),
                        unit: "EMU",
                      },
                      height: {
                        magnitude: inchesToEmu(descH),
                        unit: "EMU",
                      },
                    },
                    transform: {
                      scaleX: 1,
                      scaleY: 1,
                      shearX: 0,
                      shearY: 0,
                      translateX: inchesToEmu(cardX + padding),
                      translateY: inchesToEmu(descY),
                      unit: "EMU",
                    },
                  },
                },
              },
              {
                insertText: {
                  objectId: descId,
                  text: unescapeText(metric.description),
                  insertionIndex: 0,
                },
              },
              {
                updateTextStyle: {
                  objectId: descId,
                  style: {
                    fontFamily: style.body_font,
                    fontSize: { magnitude: descFontSize, unit: "PT" },
                    italic: true,
                    foregroundColor: {
                      opaqueColor: {
                        rgbColor: hexToRgb(style.body_text_color),
                      },
                    },
                  },
                  fields: "fontFamily,fontSize,italic,foregroundColor",
                  textRange: { type: "ALL" },
                },
              },
              {
                updateParagraphStyle: {
                  objectId: descId,
                  style: { alignment: "CENTER" },
                  fields: "alignment",
                  textRange: { type: "ALL" },
                },
              }
            );
          }
        }

        await client.batchUpdate(presentation_id, requests);

        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify(
                {
                  slide_id: actualSlideId,
                  element_ids: elementIds,
                  metric_count: count,
                  grid: `${rows}x${cols}`,
                  style_source: style.source,
                },
                null,
                2
              ),
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
