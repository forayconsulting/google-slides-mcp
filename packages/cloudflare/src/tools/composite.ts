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
import { inchesToEmu } from "../utils/units.js";
import { hexToRgb } from "../utils/colors.js";
import {
  extractPresentationStyle,
  DEFAULT_STYLE,
  type PresentationStyle,
} from "../utils/style.js";

/** Field mask for style extraction — fetches only what we need. */
const STYLE_FIELDS =
  "masters.pageProperties.colorScheme,masters.pageElements.shape.placeholder,masters.pageElements.shape.text.textElements.textRun.style";

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
 * Shared helper: create a TITLE_ONLY slide (or use existing) and find the title placeholder.
 */
async function setupSlide(
  client: SlidesClient,
  presentationId: string,
  slideId: string | undefined,
  title: string,
  subtitle?: string
): Promise<{ slideId: string; titlePlaceholderId?: string; subtitlePlaceholderId?: string }> {
  let actualSlideId: string;

  if (slideId) {
    actualSlideId = slideId;
  } else {
    // Create a TITLE_ONLY slide
    actualSlideId = generateId("slide");
    await client.batchUpdate(presentationId, [
      {
        createSlide: {
          objectId: actualSlideId,
          slideLayoutReference: { predefinedLayout: "TITLE_ONLY" },
        },
      },
    ]);
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

  if (requests.length > 0) {
    await client.batchUpdate(presentationId, requests);
  }

  return { slideId: actualSlideId, titlePlaceholderId, subtitlePlaceholderId };
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
    "Create a complete table slide in one call. Automatically applies the presentation's theme colors to headers, zebra stripes, and text. Creates a TITLE_ONLY slide (or uses existing slide_id), sets the title via template placeholder, and builds a styled data table.",
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
        const { slideId: actualSlideId } = await setupSlide(
          client,
          presentation_id,
          slide_id,
          title,
          subtitle
        );

        // Table layout
        const tableX = 0.5;
        const tableY = 1.1;
        const tableW = 9.0;
        const rowCount = data.length;
        const tableH = Math.min(4.2, Math.max(1.5, rowCount * 0.4));

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
        const { slideId: actualSlideId } = await setupSlide(
          client,
          presentation_id,
          slide_id,
          title
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

        // Chart layout
        const chartX = 0.5;
        const chartY = 1.1;
        const chartW = 9.0;
        const chartH = 4.2;

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
    "Create a complete KPI dashboard slide in one call. Automatically applies the presentation's theme colors. Creates a TITLE_ONLY slide (or uses existing slide_id), sets the title via template placeholder, and arranges 1-8 metric cards in an auto-calculated grid.",
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
        const { slideId: actualSlideId } = await setupSlide(
          client,
          presentation_id,
          slide_id,
          title
        );

        // Grid layout calculation
        const contentX = 0.5;
        const contentY = 1.1;
        const contentW = 9.0;
        const contentH = 4.2;
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
