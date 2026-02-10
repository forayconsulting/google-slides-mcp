/**
 * Visualization tools for Google Slides.
 *
 * Higher-level tools for creating tables, charts, and stat callouts
 * that produce professional visual elements in a single call.
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

function unescapeText(text: string): string {
  return text.replace(/\\n/g, "\n").replace(/\\t/g, "\t");
}

/** Format large numbers with K/M/B suffixes. */
function formatValue(value: number): string {
  if (Math.abs(value) >= 1_000_000_000) return `${(value / 1_000_000_000).toFixed(1)}B`;
  if (Math.abs(value) >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}M`;
  if (Math.abs(value) >= 10_000) return `${(value / 1_000).toFixed(1)}K`;
  if (Number.isInteger(value)) return value.toString();
  return value.toFixed(1);
}

/**
 * Register visualization tools with the MCP server.
 */
export function registerVisualizationTools(
  server: McpServer,
  tokenManager: TokenManager
): void {
  const client = new SlidesClient(tokenManager);

  /**
   * add_table - Create a styled data table
   */
  server.tool(
    "add_table",
    "Create a styled data table on a slide. Supports header row styling, zebra striping, and custom borders.",
    {
      presentation_id: z.string().describe("The presentation ID"),
      slide_id: z.string().describe("The slide to add the table to"),
      data: z.array(z.array(z.string())).describe("2D array of cell data — first row is header if header_row is true"),
      x: z.number().default(0.5).describe("X position in inches"),
      y: z.number().default(0.8).describe("Y position in inches"),
      width: z.number().default(9.0).describe("Table width in inches"),
      height: z.number().default(3.5).describe("Table height in inches"),
      header_row: z.boolean().default(true).describe("Style first row as header"),
      header_color: z.string().default("#1a73e8").describe("Header background color hex"),
      header_text_color: z.string().default("#FFFFFF").describe("Header text color hex"),
      alternate_row_color: z.string().optional().describe("Zebra stripe color for alternating rows"),
      border_color: z.string().default("#DADCE0").describe("Border color hex"),
      border_weight: z.number().default(0.5).describe("Border weight in points"),
      font_size: z.number().default(12).describe("Body text font size in points"),
      font_family: z.string().default("Arial").describe("Font family"),
    },
    async ({ presentation_id, slide_id, data, x, y, width, height, header_row, header_color, header_text_color, alternate_row_color, border_color, border_weight, font_size, font_family }) => {
      try {
        // Validate data
        if (data.length === 0) {
          return {
            content: [{ type: "text" as const, text: "Error: data must not be empty" }],
            isError: true,
          };
        }
        const colCount = data[0].length;
        if (colCount === 0) {
          return {
            content: [{ type: "text" as const, text: "Error: rows must have at least one column" }],
            isError: true,
          };
        }
        for (let i = 0; i < data.length; i++) {
          if (data[i].length !== colCount) {
            return {
              content: [{ type: "text" as const, text: `Error: row ${i} has ${data[i].length} columns, expected ${colCount}` }],
              isError: true,
            };
          }
        }

        const tableId = generateId("table");
        const rowCount = data.length;

        // Step 1: Create the table
        await client.batchUpdate(presentation_id, [
          {
            createTable: {
              objectId: tableId,
              rows: rowCount,
              columns: colCount,
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
        ]);

        // Step 2: Insert text, style cells, and set borders
        const requests: Record<string, unknown>[] = [];

        for (let row = 0; row < rowCount; row++) {
          for (let col = 0; col < colCount; col++) {
            const cellText = unescapeText(data[row][col]);

            // Insert text into cell
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
            const textColor = isHeader ? header_text_color : "#000000";
            requests.push({
              updateTextStyle: {
                objectId: tableId,
                cellLocation: { rowIndex: row, columnIndex: col },
                style: {
                  fontFamily: font_family,
                  fontSize: { magnitude: isHeader ? font_size + 1 : font_size, unit: "PT" },
                  bold: isHeader,
                  foregroundColor: {
                    opaqueColor: { rgbColor: hexToRgb(textColor) },
                  },
                },
                fields: "fontFamily,fontSize,bold,foregroundColor",
                textRange: { type: "ALL" },
              },
            });

            // Cell background: header or zebra stripe
            let bgColor: string | undefined;
            if (isHeader) {
              bgColor = header_color;
            } else if (alternate_row_color && row % 2 === 0) {
              bgColor = alternate_row_color;
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

        // Set border properties for all cells
        const borderRgb = hexToRgb(border_color);
        const borderDef = {
          tableBorderFill: {
            solidFill: { color: { rgbColor: borderRgb } },
          },
          weight: { magnitude: border_weight, unit: "PT" },
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
              text: JSON.stringify({
                element_id: tableId,
                rows: rowCount,
                columns: colCount,
              }, null, 2),
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
   * add_bar_chart - Create a shape-based bar chart (no Sheets dependency)
   */
  server.tool(
    "add_bar_chart",
    "Create a bar chart using shapes. No Google Sheets dependency — renders directly on the slide with proportionally-scaled bars. NOTE: For automatic theme colors, prefer create_chart_slide (composite tool). This tool requires explicit color/bar_color_scale parameters.",
    {
      presentation_id: z.string().describe("The presentation ID"),
      slide_id: z.string().describe("The slide to add the chart to"),
      labels: z.array(z.string()).describe("Category labels for each bar"),
      values: z.array(z.number()).describe("Numeric values for each bar"),
      title: z.string().optional().describe("Chart title"),
      color: z.string().default("#1a73e8").describe("Bar fill color"),
      x: z.number().default(0.5).describe("X position in inches"),
      y: z.number().default(0.8).describe("Y position in inches"),
      width: z.number().default(9.0).describe("Total chart width in inches"),
      height: z.number().default(4.0).describe("Total chart height in inches"),
      show_values: z.boolean().default(true).describe("Show value labels above bars"),
      bar_color_scale: z.array(z.string()).optional().describe("Per-bar colors (overrides color)"),
    },
    async ({ presentation_id, slide_id, labels, values, title, color, x, y, width, height, show_values, bar_color_scale }) => {
      try {
        // Validate
        if (labels.length !== values.length) {
          return {
            content: [{ type: "text" as const, text: "Error: labels and values must have the same length" }],
            isError: true,
          };
        }
        if (labels.length === 0) {
          return {
            content: [{ type: "text" as const, text: "Error: must have at least one data point" }],
            isError: true,
          };
        }
        const maxValue = Math.max(...values);
        if (maxValue <= 0) {
          return {
            content: [{ type: "text" as const, text: "Error: at least one value must be positive" }],
            isError: true,
          };
        }
        if (bar_color_scale && bar_color_scale.length !== labels.length) {
          return {
            content: [{ type: "text" as const, text: "Error: bar_color_scale must match labels length" }],
            isError: true,
          };
        }

        const requests: Record<string, unknown>[] = [];
        const elementIds: string[] = [];

        // Layout calculations
        const titleHeight = title ? 0.5 : 0;
        const valueLabelHeight = show_values ? 0.35 : 0;
        const categoryLabelHeight = 0.35;
        const chartAreaX = x;
        const chartAreaY = y + titleHeight;
        const chartAreaWidth = width;
        const maxBarHeight = height - titleHeight - valueLabelHeight - categoryLabelHeight;

        const barCount = labels.length;
        const gapRatio = 0.3;
        const barWidth = chartAreaWidth / (barCount + (barCount + 1) * gapRatio);
        const gapWidth = barWidth * gapRatio;

        // Optional title
        if (title) {
          const titleId = generateId("charttitle");
          elementIds.push(titleId);
          requests.push(
            {
              createShape: {
                objectId: titleId,
                shapeType: "TEXT_BOX",
                elementProperties: {
                  pageObjectId: slide_id,
                  size: {
                    width: { magnitude: inchesToEmu(width), unit: "EMU" },
                    height: { magnitude: inchesToEmu(titleHeight), unit: "EMU" },
                  },
                  transform: {
                    scaleX: 1, scaleY: 1, shearX: 0, shearY: 0,
                    translateX: inchesToEmu(x),
                    translateY: inchesToEmu(y),
                    unit: "EMU",
                  },
                },
              },
            },
            {
              insertText: {
                objectId: titleId,
                text: unescapeText(title),
                insertionIndex: 0,
              },
            },
            {
              updateTextStyle: {
                objectId: titleId,
                style: {
                  fontFamily: "Arial",
                  fontSize: { magnitude: 16, unit: "PT" },
                  bold: true,
                  foregroundColor: { opaqueColor: { rgbColor: hexToRgb("#333333") } },
                },
                fields: "fontFamily,fontSize,bold,foregroundColor",
                textRange: { type: "ALL" },
              },
            },
            {
              updateParagraphStyle: {
                objectId: titleId,
                style: { alignment: "CENTER" },
                fields: "alignment",
                textRange: { type: "ALL" },
              },
            },
          );
        }

        // Draw bars + labels
        for (let i = 0; i < barCount; i++) {
          const barX = chartAreaX + gapWidth + i * (barWidth + gapWidth);
          const barHeight = Math.max((values[i] / maxValue) * maxBarHeight, 0.02);
          const barY = chartAreaY + valueLabelHeight + (maxBarHeight - barHeight);
          const barColor = bar_color_scale ? bar_color_scale[i] : color;

          // Bar rectangle
          const barId = generateId("bar");
          elementIds.push(barId);
          requests.push(
            {
              createShape: {
                objectId: barId,
                shapeType: "RECTANGLE",
                elementProperties: {
                  pageObjectId: slide_id,
                  size: {
                    width: { magnitude: inchesToEmu(barWidth), unit: "EMU" },
                    height: { magnitude: inchesToEmu(barHeight), unit: "EMU" },
                  },
                  transform: {
                    scaleX: 1, scaleY: 1, shearX: 0, shearY: 0,
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
                    solidFill: { color: { rgbColor: hexToRgb(barColor) } },
                  },
                  outline: { propertyState: "NOT_RENDERED" },
                },
                fields: "shapeBackgroundFill,outline",
              },
            },
          );

          // Value label above bar
          if (show_values) {
            const valLabelId = generateId("val");
            elementIds.push(valLabelId);
            const valLabelY = barY - valueLabelHeight;
            requests.push(
              {
                createShape: {
                  objectId: valLabelId,
                  shapeType: "TEXT_BOX",
                  elementProperties: {
                    pageObjectId: slide_id,
                    size: {
                      width: { magnitude: inchesToEmu(barWidth), unit: "EMU" },
                      height: { magnitude: inchesToEmu(valueLabelHeight), unit: "EMU" },
                    },
                    transform: {
                      scaleX: 1, scaleY: 1, shearX: 0, shearY: 0,
                      translateX: inchesToEmu(barX),
                      translateY: inchesToEmu(valLabelY),
                      unit: "EMU",
                    },
                  },
                },
              },
              {
                insertText: {
                  objectId: valLabelId,
                  text: formatValue(values[i]),
                  insertionIndex: 0,
                },
              },
              {
                updateTextStyle: {
                  objectId: valLabelId,
                  style: {
                    fontFamily: "Arial",
                    fontSize: { magnitude: 10, unit: "PT" },
                    bold: true,
                    foregroundColor: { opaqueColor: { rgbColor: hexToRgb("#555555") } },
                  },
                  fields: "fontFamily,fontSize,bold,foregroundColor",
                  textRange: { type: "ALL" },
                },
              },
              {
                updateParagraphStyle: {
                  objectId: valLabelId,
                  style: { alignment: "CENTER" },
                  fields: "alignment",
                  textRange: { type: "ALL" },
                },
              },
            );
          }

          // Category label below bar
          const catLabelId = generateId("cat");
          elementIds.push(catLabelId);
          const catLabelY = chartAreaY + valueLabelHeight + maxBarHeight;
          requests.push(
            {
              createShape: {
                objectId: catLabelId,
                shapeType: "TEXT_BOX",
                elementProperties: {
                  pageObjectId: slide_id,
                  size: {
                    width: { magnitude: inchesToEmu(barWidth + gapWidth), unit: "EMU" },
                    height: { magnitude: inchesToEmu(categoryLabelHeight), unit: "EMU" },
                  },
                  transform: {
                    scaleX: 1, scaleY: 1, shearX: 0, shearY: 0,
                    translateX: inchesToEmu(barX - gapWidth / 2),
                    translateY: inchesToEmu(catLabelY),
                    unit: "EMU",
                  },
                },
              },
            },
            {
              insertText: {
                objectId: catLabelId,
                text: unescapeText(labels[i]),
                insertionIndex: 0,
              },
            },
            {
              updateTextStyle: {
                objectId: catLabelId,
                style: {
                  fontFamily: "Arial",
                  fontSize: { magnitude: 10, unit: "PT" },
                  foregroundColor: { opaqueColor: { rgbColor: hexToRgb("#666666") } },
                },
                fields: "fontFamily,fontSize,foregroundColor",
                textRange: { type: "ALL" },
              },
            },
            {
              updateParagraphStyle: {
                objectId: catLabelId,
                style: { alignment: "CENTER" },
                fields: "alignment",
                textRange: { type: "ALL" },
              },
            },
          );
        }

        await client.batchUpdate(presentation_id, requests);

        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify({
                element_ids: elementIds,
                bar_count: barCount,
              }, null, 2),
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
   * add_stat_callout - Create a KPI/metric display card
   */
  server.tool(
    "add_stat_callout",
    "Create a KPI/metric display card with a large stat value, label, and optional description. Use for dashboards and summary slides.",
    {
      presentation_id: z.string().describe("The presentation ID"),
      slide_id: z.string().describe("The slide to add the callout to"),
      stat_value: z.string().describe("Main stat value (e.g., '3.5M', '99.9%')"),
      label: z.string().describe("Label below the stat (e.g., 'Active Users')"),
      description: z.string().optional().describe("Optional context line (e.g., 'Up 25% YoY')"),
      x: z.number().default(1).describe("X position in inches"),
      y: z.number().default(1).describe("Y position in inches"),
      width: z.number().default(2.5).describe("Card width in inches"),
      height: z.number().default(2.0).describe("Card height in inches"),
      color: z.string().default("#1a73e8").describe("Accent color for stat value"),
      background_color: z.string().optional().describe("Card background color (null = transparent)"),
      stat_font_size: z.number().default(48).describe("Stat value font size in points"),
      label_font_size: z.number().default(14).describe("Label font size in points"),
    },
    async ({ presentation_id, slide_id, stat_value, label, description, x, y, width, height, color, background_color, stat_font_size, label_font_size }) => {
      try {
        const requests: Record<string, unknown>[] = [];
        const elementIds: string[] = [];

        // Background card
        if (background_color) {
          const bgId = generateId("statbg");
          elementIds.push(bgId);
          requests.push(
            {
              createShape: {
                objectId: bgId,
                shapeType: "ROUND_RECTANGLE",
                elementProperties: {
                  pageObjectId: slide_id,
                  size: {
                    width: { magnitude: inchesToEmu(width), unit: "EMU" },
                    height: { magnitude: inchesToEmu(height), unit: "EMU" },
                  },
                  transform: {
                    scaleX: 1, scaleY: 1, shearX: 0, shearY: 0,
                    translateX: inchesToEmu(x),
                    translateY: inchesToEmu(y),
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
                    solidFill: { color: { rgbColor: hexToRgb(background_color) } },
                  },
                  outline: { propertyState: "NOT_RENDERED" },
                },
                fields: "shapeBackgroundFill,outline",
              },
            },
          );
        }

        // Layout: stat value takes upper portion, label below, description at bottom
        const padding = 0.15;
        const innerWidth = width - padding * 2;
        const statHeight = height * 0.5;
        const labelHeight = height * 0.2;
        const descHeight = description ? height * 0.2 : 0;

        // Stat value
        const statId = generateId("statval");
        elementIds.push(statId);
        requests.push(
          {
            createShape: {
              objectId: statId,
              shapeType: "TEXT_BOX",
              elementProperties: {
                pageObjectId: slide_id,
                size: {
                  width: { magnitude: inchesToEmu(innerWidth), unit: "EMU" },
                  height: { magnitude: inchesToEmu(statHeight), unit: "EMU" },
                },
                transform: {
                  scaleX: 1, scaleY: 1, shearX: 0, shearY: 0,
                  translateX: inchesToEmu(x + padding),
                  translateY: inchesToEmu(y + padding),
                  unit: "EMU",
                },
              },
            },
          },
          {
            insertText: {
              objectId: statId,
              text: unescapeText(stat_value),
              insertionIndex: 0,
            },
          },
          {
            updateTextStyle: {
              objectId: statId,
              style: {
                fontFamily: "Arial",
                fontSize: { magnitude: stat_font_size, unit: "PT" },
                bold: true,
                foregroundColor: { opaqueColor: { rgbColor: hexToRgb(color) } },
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
          },
        );

        // Label
        const labelId = generateId("statlbl");
        elementIds.push(labelId);
        const labelY = y + padding + statHeight;
        requests.push(
          {
            createShape: {
              objectId: labelId,
              shapeType: "TEXT_BOX",
              elementProperties: {
                pageObjectId: slide_id,
                size: {
                  width: { magnitude: inchesToEmu(innerWidth), unit: "EMU" },
                  height: { magnitude: inchesToEmu(labelHeight), unit: "EMU" },
                },
                transform: {
                  scaleX: 1, scaleY: 1, shearX: 0, shearY: 0,
                  translateX: inchesToEmu(x + padding),
                  translateY: inchesToEmu(labelY),
                  unit: "EMU",
                },
              },
            },
          },
          {
            insertText: {
              objectId: labelId,
              text: unescapeText(label),
              insertionIndex: 0,
            },
          },
          {
            updateTextStyle: {
              objectId: labelId,
              style: {
                fontFamily: "Arial",
                fontSize: { magnitude: label_font_size, unit: "PT" },
                foregroundColor: { opaqueColor: { rgbColor: hexToRgb("#666666") } },
              },
              fields: "fontFamily,fontSize,foregroundColor",
              textRange: { type: "ALL" },
            },
          },
          {
            updateParagraphStyle: {
              objectId: labelId,
              style: { alignment: "CENTER" },
              fields: "alignment",
              textRange: { type: "ALL" },
            },
          },
        );

        // Optional description
        if (description) {
          const descId = generateId("statdesc");
          elementIds.push(descId);
          const descY = labelY + labelHeight;
          requests.push(
            {
              createShape: {
                objectId: descId,
                shapeType: "TEXT_BOX",
                elementProperties: {
                  pageObjectId: slide_id,
                  size: {
                    width: { magnitude: inchesToEmu(innerWidth), unit: "EMU" },
                    height: { magnitude: inchesToEmu(descHeight), unit: "EMU" },
                  },
                  transform: {
                    scaleX: 1, scaleY: 1, shearX: 0, shearY: 0,
                    translateX: inchesToEmu(x + padding),
                    translateY: inchesToEmu(descY),
                    unit: "EMU",
                  },
                },
              },
            },
            {
              insertText: {
                objectId: descId,
                text: unescapeText(description),
                insertionIndex: 0,
              },
            },
            {
              updateTextStyle: {
                objectId: descId,
                style: {
                  fontFamily: "Arial",
                  fontSize: { magnitude: 11, unit: "PT" },
                  italic: true,
                  foregroundColor: { opaqueColor: { rgbColor: hexToRgb("#999999") } },
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
            },
          );
        }

        await client.batchUpdate(presentation_id, requests);

        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify({ element_ids: elementIds }, null, 2),
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
