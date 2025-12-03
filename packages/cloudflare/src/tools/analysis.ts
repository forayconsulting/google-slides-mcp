/**
 * Presentation analysis tools for Google Slides.
 *
 * Tools for deep-diving into presentations to extract style guides,
 * structural patterns, and usage recommendations.
 */

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { SlidesClient } from "../api/slides-client.js";
import type { Props } from "../types.js";
import type { Page, Presentation } from "../api/types.js";
import { emuToInches } from "../utils/units.js";

interface SlideInfo {
  slide_id: string;
  index: number;
  element_count: number;
  title: string;
  subtitle: string;
  has_image: boolean;
  has_chart: boolean;
  has_table: boolean;
  placeholder_types: string[];
  category?: string;
}

interface PlaceholderText {
  type: string;
  text: string;
  slide_index: number;
}

/**
 * Extract color from Google Slides color data.
 */
function extractColor(
  colorData: Record<string, unknown>,
  context: string,
  colorsFound: Map<string, string[]>
): void {
  const rgb = colorData.rgbColor as Record<string, number> | undefined;
  const themeColor = colorData.themeColor as string | undefined;

  let colorKey: string;
  if (themeColor) {
    colorKey = `theme:${themeColor}`;
  } else if (rgb) {
    const r = Math.floor((rgb.red ?? 0) * 255);
    const g = Math.floor((rgb.green ?? 0) * 255);
    const b = Math.floor((rgb.blue ?? 0) * 255);
    colorKey = `#${r.toString(16).padStart(2, "0")}${g.toString(16).padStart(2, "0")}${b.toString(16).padStart(2, "0")}`;
  } else {
    return;
  }

  const contexts = colorsFound.get(colorKey) ?? [];
  if (!contexts.includes(context)) {
    contexts.push(context);
    colorsFound.set(colorKey, contexts);
  }
}

/**
 * Categorize a slide based on its content and structure.
 */
function categorizeSlide(slideInfo: SlideInfo): string {
  const title = slideInfo.title.toLowerCase();
  const placeholders = slideInfo.placeholder_types;
  const elementCount = slideInfo.element_count;

  // Cover detection
  if (
    title.includes("cover") ||
    title.includes("title page") ||
    (elementCount <= 4 &&
      placeholders.includes("TITLE") &&
      placeholders.includes("BODY") &&
      slideInfo.index < 15)
  ) {
    return "cover";
  }

  // Section divider detection
  if (
    title.includes("section") ||
    title.includes("divider") ||
    (elementCount <= 3 &&
      placeholders.includes("TITLE") &&
      (placeholders.includes("SUBTITLE") || elementCount === 1))
  ) {
    return "section_divider";
  }

  // Data visualization
  if (
    slideInfo.has_chart ||
    title.includes("chart") ||
    title.includes("graph") ||
    title.includes("table") ||
    title.includes("data")
  ) {
    return "data_visualization";
  }

  if (slideInfo.has_table) {
    return "data_visualization";
  }

  // Infographic detection
  if (title.includes("infographic") || elementCount > 15) {
    return "infographic";
  }

  // Mockup detection
  if (
    title.includes("mockup") ||
    title.includes("phone") ||
    title.includes("laptop") ||
    title.includes("device")
  ) {
    return "mockup";
  }

  // Image-focused
  if (slideInfo.has_image && elementCount <= 5) {
    return "image_focused";
  }

  // Content (default for slides with substantial content)
  if (placeholders.includes("BODY") || elementCount >= 3) {
    return "content";
  }

  return "other";
}

/**
 * Analyze placeholder texts to find common patterns.
 */
function analyzePlaceholderPatterns(placeholderTexts: PlaceholderText[]): Record<string, unknown> {
  const patterns: Record<string, unknown[]> = {
    title_patterns: [],
    subtitle_patterns: [],
    body_patterns: [],
    date_patterns: [],
    name_patterns: [],
  };

  for (const item of placeholderTexts) {
    const text = item.text;
    const ptype = item.type;

    // Detect date patterns
    if (
      text.includes("MM.DD") ||
      text.includes("YYYY") ||
      text.includes("mm/dd") ||
      text.toLowerCase().includes("date")
    ) {
      const datePatterns = patterns.date_patterns as Array<{ text: string; type: string }>;
      if (!datePatterns.some((p) => p.text === text)) {
        datePatterns.push({ text, type: ptype });
      }
    }

    // Detect name patterns
    if (
      text.toLowerCase().includes("full name") ||
      text.includes("name //") ||
      text.toLowerCase().includes("job title")
    ) {
      const namePatterns = patterns.name_patterns as Array<{ text: string; type: string }>;
      if (!namePatterns.some((p) => p.text === text)) {
        namePatterns.push({ text, type: ptype });
      }
    }

    // Collect by placeholder type
    if (ptype === "TITLE") {
      const titlePatterns = patterns.title_patterns as string[];
      if (titlePatterns.length < 10) {
        titlePatterns.push(text);
      }
    } else if (ptype === "SUBTITLE") {
      const subtitlePatterns = patterns.subtitle_patterns as string[];
      if (subtitlePatterns.length < 10) {
        subtitlePatterns.push(text);
      }
    } else if (ptype === "BODY") {
      const bodyPatterns = patterns.body_patterns as string[];
      if (bodyPatterns.length < 5) {
        bodyPatterns.push(text.length > 50 ? text.substring(0, 50) + "..." : text);
      }
    }
  }

  return patterns;
}

/**
 * Generate usage recommendations based on analysis.
 */
function generateRecommendations(
  slidesInfo: SlideInfo[],
  placeholderPatterns: Record<string, unknown>,
  fontsFound: Map<string, string[]>,
  colorsFound: Map<string, string[]>
): string[] {
  const recommendations: string[] = [];

  // Slide usage recommendations
  const coverSlides = slidesInfo.filter((s) => s.category === "cover");
  if (coverSlides.length > 0) {
    const indices = coverSlides.slice(0, 4).map((s) => s.index + 1).join(", ");
    recommendations.push(
      `Use slides ${indices} as cover options (found ${coverSlides.length} cover variants)`
    );
  }

  const sectionSlides = slidesInfo.filter((s) => s.category === "section_divider");
  if (sectionSlides.length > 0) {
    const indices = sectionSlides.slice(0, 2).map((s) => s.index + 1).join(", ");
    recommendations.push(`Use slides ${indices} as section dividers`);
  }

  // Placeholder recommendations
  const datePatterns = placeholderPatterns.date_patterns as Array<{ text: string }>;
  if (datePatterns && datePatterns.length > 0) {
    recommendations.push(
      `Replace date placeholder '${datePatterns[0].text}' with actual dates`
    );
  }

  const namePatterns = placeholderPatterns.name_patterns as Array<{ text: string }>;
  if (namePatterns && namePatterns.length > 0) {
    recommendations.push(
      `Replace name placeholder '${namePatterns[0].text}' with presenter info`
    );
  }

  // Font recommendation
  if (fontsFound.size > 0) {
    let primaryFont = "";
    let maxUsage = 0;
    for (const [font, contexts] of fontsFound) {
      if (contexts.length > maxUsage) {
        maxUsage = contexts.length;
        primaryFont = font;
      }
    }
    if (primaryFont) {
      recommendations.push(
        `Maintain '${primaryFont}' as the primary font for consistency`
      );
    }
  }

  // Color recommendation
  if (colorsFound.size > 0) {
    const sortedColors = [...colorsFound.entries()]
      .sort((a, b) => b[1].length - a[1].length)
      .slice(0, 3)
      .map(([color]) => color);
    recommendations.push(`Primary brand colors detected: ${sortedColors.join(", ")}`);
  }

  // Workflow recommendation
  recommendations.push(
    "Workflow: copy_template → delete unused slides → replace_placeholders → add images"
  );

  return recommendations;
}

/**
 * Select key representative slides for thumbnails.
 */
function selectKeySlides(slidesInfo: SlideInfo[], maxCount: number): SlideInfo[] {
  const keySlides: SlideInfo[] = [];
  const categoriesSeen = new Set<string>();

  const priorityOrder = [
    "cover",
    "section_divider",
    "content",
    "data_visualization",
    "mockup",
    "infographic",
  ];

  for (const category of priorityOrder) {
    if (keySlides.length >= maxCount) break;
    for (const slide of slidesInfo) {
      if (slide.category === category && !categoriesSeen.has(category)) {
        keySlides.push(slide);
        categoriesSeen.add(category);
        break;
      }
    }
  }

  // Fill remaining slots
  for (const slide of slidesInfo) {
    if (keySlides.length >= maxCount) break;
    if (!keySlides.includes(slide)) {
      keySlides.push(slide);
    }
  }

  return keySlides.slice(0, maxCount);
}

/**
 * Register analysis tools with the MCP server.
 */
export function registerAnalysisTools(
  server: McpServer,
  _env: Env,
  props: Props
): void {
  const client = new SlidesClient({ accessToken: props.accessToken });

  /**
   * analyze_presentation - Deep-dive analysis of a presentation
   */
  server.tool(
    "analyze_presentation",
    "Deep-dive analysis of a presentation to extract style guide information. Analyzes structure, styling, colors, fonts, placeholders, and layouts.",
    {
      presentation_id: z.string().describe("The presentation ID to analyze"),
      include_thumbnails: z.boolean().default(false).describe("Whether to generate thumbnail URLs for key slides"),
      max_thumbnail_slides: z.number().min(1).max(10).default(5).describe("Maximum number of thumbnails to generate"),
    },
    async ({ presentation_id, include_thumbnails, max_thumbnail_slides }) => {
      try {
        const presentation = await client.getPresentation(presentation_id);

        // Initialize analysis containers
        const colorsFound = new Map<string, string[]>();
        const fontsFound = new Map<string, string[]>();
        const fontSizes = new Map<number, number>();
        const placeholderTexts: PlaceholderText[] = [];
        const slideCategories: Record<string, Array<{ index: number; slide_id: string; title: string }>> = {
          cover: [],
          section_divider: [],
          content: [],
          image_focused: [],
          data_visualization: [],
          mockup: [],
          infographic: [],
          other: [],
        };

        // Extract page size
        const pageSize = presentation.pageSize;
        const widthEmu = pageSize?.width?.magnitude ?? 0;
        const heightEmu = pageSize?.height?.magnitude ?? 0;
        const widthInches = emuToInches(widthEmu);
        const heightInches = emuToInches(heightEmu);

        // Determine aspect ratio
        let aspectRatio: string;
        if (widthInches > 0 && heightInches > 0) {
          const ratio = widthInches / heightInches;
          if (Math.abs(ratio - 16 / 9) < 0.1) {
            aspectRatio = "16:9 (Widescreen)";
          } else if (Math.abs(ratio - 4 / 3) < 0.1) {
            aspectRatio = "4:3 (Standard)";
          } else if (Math.abs(ratio - 16 / 10) < 0.1) {
            aspectRatio = "16:10";
          } else {
            aspectRatio = `${ratio.toFixed(2)}:1 (Custom)`;
          }
        } else {
          aspectRatio = "Unknown";
        }

        const slides = presentation.slides ?? [];
        const slidesInfo: SlideInfo[] = [];

        for (let i = 0; i < slides.length; i++) {
          const slide = slides[i];
          const slideId = slide.objectId ?? "";
          const pageElements = slide.pageElements ?? [];
          const elementCount = pageElements.length;

          const slideInfo: SlideInfo = {
            slide_id: slideId,
            index: i,
            element_count: elementCount,
            title: "",
            subtitle: "",
            has_image: false,
            has_chart: false,
            has_table: false,
            placeholder_types: [],
          };

          // Analyze each element
          for (const element of pageElements) {
            // Check element types
            if (element.image) {
              slideInfo.has_image = true;
            } else if ((element as unknown as Record<string, unknown>).sheetsChart) {
              slideInfo.has_chart = true;
            } else if (element.table) {
              slideInfo.has_table = true;
            }

            // Analyze shapes
            const shape = element.shape;
            if (shape) {
              const placeholder = shape.placeholder;
              const placeholderType = placeholder?.type;

              if (placeholderType) {
                slideInfo.placeholder_types.push(placeholderType);
              }

              // Extract text content
              const textElements = shape.text?.textElements ?? [];

              for (const textElem of textElements) {
                const textRun = textElem.textRun;
                const content = (textRun?.content ?? "").trim();
                const style = textRun?.style;

                if (content) {
                  // Store placeholder text
                  if (placeholderType) {
                    if (placeholderType === "TITLE") {
                      slideInfo.title = content;
                    } else if (placeholderType === "SUBTITLE") {
                      slideInfo.subtitle = content;
                    }

                    placeholderTexts.push({
                      type: placeholderType,
                      text: content.substring(0, 100),
                      slide_index: i,
                    });
                  }

                  // Extract font info
                  const fontFamily = style?.fontFamily;
                  if (fontFamily) {
                    const contexts = fontsFound.get(fontFamily) ?? [];
                    const context = `Slide ${i + 1}`;
                    if (!contexts.includes(context)) {
                      contexts.push(context);
                      fontsFound.set(fontFamily, contexts);
                    }
                  }

                  // Extract font size
                  const fontSize = style?.fontSize?.magnitude;
                  if (fontSize) {
                    fontSizes.set(fontSize, (fontSizes.get(fontSize) ?? 0) + 1);
                  }

                  // Extract text color
                  const fgColor = style?.foregroundColor?.opaqueColor;
                  if (fgColor) {
                    extractColor(
                      fgColor as unknown as Record<string, unknown>,
                      `Text on slide ${i + 1}`,
                      colorsFound
                    );
                  }
                }
              }

              // Extract shape colors
              const shapeProps = shape.shapeProperties;
              const bgFill = shapeProps?.shapeBackgroundFill;
              const solidFill = (bgFill as Record<string, unknown>)?.solidFill as Record<string, unknown> | undefined;
              if (solidFill?.color) {
                extractColor(
                  solidFill.color as Record<string, unknown>,
                  `Shape fill on slide ${i + 1}`,
                  colorsFound
                );
              }
            }
          }

          // Categorize slide
          const category = categorizeSlide(slideInfo);
          slideInfo.category = category;
          slideCategories[category].push({
            index: i,
            slide_id: slideId,
            title: slideInfo.title,
          });

          slidesInfo.push(slideInfo);
        }

        // Generate placeholder pattern analysis
        const placeholderPatterns = analyzePlaceholderPatterns(placeholderTexts);

        // Build recommendations
        const recommendations = generateRecommendations(
          slidesInfo,
          placeholderPatterns,
          fontsFound,
          colorsFound
        );

        // Generate thumbnails if requested
        const thumbnails: Array<{
          slide_index: number;
          slide_id: string;
          title: string;
          category: string;
          url: string;
        }> = [];

        if (include_thumbnails) {
          const keySlides = selectKeySlides(slidesInfo, max_thumbnail_slides);
          for (const slideInfo of keySlides) {
            try {
              const thumbnail = await client.getThumbnail(
                presentation_id,
                slideInfo.slide_id,
                "PNG"
              );
              thumbnails.push({
                slide_index: slideInfo.index,
                slide_id: slideInfo.slide_id,
                title: slideInfo.title,
                category: slideInfo.category ?? "unknown",
                url: thumbnail.contentUrl ?? "",
              });
            } catch {
              // Skip failed thumbnails
            }
          }
        }

        // Build color palette summary
        const colorPalette = [...colorsFound.entries()]
          .map(([color, contexts]) => ({
            color,
            usage_count: contexts.length,
            contexts: contexts.slice(0, 5),
          }))
          .sort((a, b) => b.usage_count - a.usage_count)
          .slice(0, 20);

        // Build typography summary
        let primaryFont: string | null = null;
        let maxFontUsage = 0;
        for (const [font, contexts] of fontsFound) {
          if (contexts.length > maxFontUsage) {
            maxFontUsage = contexts.length;
            primaryFont = font;
          }
        }

        const typography = {
          fonts: [...fontsFound.keys()],
          primary_font: primaryFont,
          font_sizes: [...fontSizes.entries()]
            .sort((a, b) => b[1] - a[1])
            .slice(0, 10)
            .map(([size, count]) => ({ size_pt: size, count })),
        };

        // Build layout categories summary
        const layoutSummary: Record<string, { count: number; slides: unknown[] }> = {};
        for (const [category, slidesList] of Object.entries(slideCategories)) {
          if (slidesList.length > 0) {
            layoutSummary[category] = {
              count: slidesList.length,
              slides: slidesList.slice(0, 10),
            };
          }
        }

        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify(
                {
                  overview: {
                    presentation_id,
                    title: presentation.title ?? "Untitled",
                    total_slides: slides.length,
                    page_size: {
                      width_inches: Math.round(widthInches * 100) / 100,
                      height_inches: Math.round(heightInches * 100) / 100,
                    },
                    aspect_ratio: aspectRatio,
                    url: `https://docs.google.com/presentation/d/${presentation_id}`,
                  },
                  slide_inventory: slidesInfo,
                  color_palette: colorPalette,
                  typography,
                  placeholder_patterns: placeholderPatterns,
                  layout_categories: layoutSummary,
                  recommendations,
                  thumbnails: include_thumbnails ? thumbnails : null,
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
