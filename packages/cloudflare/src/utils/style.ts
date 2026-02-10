/**
 * Style extraction utilities for Google Slides presentations.
 *
 * Extracts theme colors and fonts from a presentation's master page,
 * providing a compact style object for composite tools.
 */

import type { Presentation, Page, PageElement } from "../api/types.js";
import { rgbToHex } from "./colors.js";

/**
 * Compact style object extracted from a presentation's theme.
 */
export interface PresentationStyle {
  primary_color: string;
  accent_colors: string[];
  heading_font: string;
  body_font: string;
  heading_text_color: string;
  body_text_color: string;
  background_color: string;
  alt_background_color: string;
  source: "theme" | "defaults";
}

/**
 * Default style used when theme extraction fails.
 */
export const DEFAULT_STYLE: PresentationStyle = {
  primary_color: "#1a73e8",
  accent_colors: ["#ea4335", "#fbbc04", "#34a853", "#4285f4", "#ff6d01"],
  heading_font: "Arial",
  body_font: "Arial",
  heading_text_color: "#202124",
  body_text_color: "#5f6368",
  background_color: "#FFFFFF",
  alt_background_color: "#F8F9FA",
  source: "defaults",
};

/**
 * Theme color type names from the Google Slides API.
 */
const THEME_COLOR_TYPES = [
  "DARK1",
  "LIGHT1",
  "DARK2",
  "LIGHT2",
  "ACCENT1",
  "ACCENT2",
  "ACCENT3",
  "ACCENT4",
  "ACCENT5",
  "ACCENT6",
] as const;

/**
 * Extract presentation style from master page theme.
 *
 * Reads the first master's color scheme and placeholder text styles
 * to build a compact style object.
 *
 * @param presentation - Presentation data (must include masters with
 *   pageProperties.colorScheme and pageElements with placeholder text styles)
 * @returns PresentationStyle with theme colors and fonts
 */
export function extractPresentationStyle(
  presentation: Presentation
): PresentationStyle {
  const master = presentation.masters?.[0];
  if (!master) {
    return { ...DEFAULT_STYLE };
  }

  // Extract theme colors from color scheme
  const colorMap = extractColorMap(master);
  const hasColors = Object.keys(colorMap).length > 0;

  // Extract fonts from placeholder text styles
  const fonts = extractFontsFromPlaceholders(master);

  if (!hasColors && !fonts.heading && !fonts.body) {
    return { ...DEFAULT_STYLE };
  }

  return {
    primary_color: colorMap.ACCENT1 ?? DEFAULT_STYLE.primary_color,
    accent_colors: [
      colorMap.ACCENT2,
      colorMap.ACCENT3,
      colorMap.ACCENT4,
      colorMap.ACCENT5,
      colorMap.ACCENT6,
    ].filter((c): c is string => c !== undefined),
    heading_font: fonts.heading ?? DEFAULT_STYLE.heading_font,
    body_font: fonts.body ?? DEFAULT_STYLE.body_font,
    heading_text_color: colorMap.DARK1 ?? DEFAULT_STYLE.heading_text_color,
    body_text_color: colorMap.DARK2 ?? DEFAULT_STYLE.body_text_color,
    background_color: colorMap.LIGHT1 ?? DEFAULT_STYLE.background_color,
    alt_background_color: colorMap.LIGHT2 ?? DEFAULT_STYLE.alt_background_color,
    source: "theme",
  };
}

/**
 * Extract theme color map from a master page's color scheme.
 */
function extractColorMap(master: Page): Record<string, string> {
  const colors = master.pageProperties?.colorScheme?.colors;
  if (!colors) return {};

  const map: Record<string, string> = {};
  for (const pair of colors) {
    if (
      pair.type &&
      THEME_COLOR_TYPES.includes(pair.type as (typeof THEME_COLOR_TYPES)[number]) &&
      pair.color?.rgbColor
    ) {
      map[pair.type] = rgbToHex(pair.color.rgbColor);
    }
  }
  return map;
}

/**
 * Extract heading and body fonts from master page placeholders.
 */
function extractFontsFromPlaceholders(
  master: Page
): { heading?: string; body?: string } {
  const result: { heading?: string; body?: string } = {};

  for (const element of master.pageElements ?? []) {
    const placeholder = element.shape?.placeholder;
    if (!placeholder) continue;

    const font = getFirstTextRunFont(element);
    if (!font) continue;

    if (
      placeholder.type === "TITLE" ||
      placeholder.type === "CENTERED_TITLE"
    ) {
      result.heading ??= font;
    } else if (placeholder.type === "BODY" || placeholder.type === "SUBTITLE") {
      result.body ??= font;
    }
  }

  return result;
}

/**
 * Get the font family from the first text run in an element.
 */
function getFirstTextRunFont(element: PageElement): string | undefined {
  const textElements = element.shape?.text?.textElements;
  if (!textElements) return undefined;

  for (const te of textElements) {
    if (te.textRun?.style?.fontFamily) {
      return te.textRun.style.fontFamily;
    }
  }
  return undefined;
}
