/**
 * Style extraction utilities for Google Slides presentations.
 *
 * Extracts theme colors and fonts from a presentation's master page,
 * providing a compact style object for composite tools.
 *
 * When the master color scheme is empty (common with PPTX-converted files),
 * falls back to sampling colors from actual slide elements.
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
  source: "theme" | "slide_sampling" | "defaults";
}

/**
 * Default style used when theme extraction fails.
 */
export const DEFAULT_STYLE: PresentationStyle = {
  primary_color: "#054950",
  accent_colors: ["#C84F09", "#6A1933", "#2B3F60", "#92E5B7", "#B699E1"],
  heading_font: "Nunito Sans",
  body_font: "Nunito Sans",
  heading_text_color: "#054950",
  body_text_color: "#3C4043",
  background_color: "#FFFFFF",
  alt_background_color: "#F0FAFA",
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
 * Colors to exclude when sampling from slides (too generic).
 */
const GENERIC_COLORS = new Set([
  "#FFFFFF", "#000000", "#F8F9FA", "#F1F3F4",
  "#E8EAED", "#DADCE0", "#BDC1C6", "#9AA0A6",
  "#80868B", "#5F6368", "#3C4043", "#202124",
]);

/**
 * Lighten a hex color by mixing with white.
 */
function lightenColor(hex: string, amount: number): string {
  const h = hex.replace("#", "");
  const r = parseInt(h.substring(0, 2), 16);
  const g = parseInt(h.substring(2, 4), 16);
  const b = parseInt(h.substring(4, 6), 16);
  const lr = Math.round(r + (255 - r) * amount);
  const lg = Math.round(g + (255 - g) * amount);
  const lb = Math.round(b + (255 - b) * amount);
  return `#${lr.toString(16).padStart(2, "0").toUpperCase()}${lg.toString(16).padStart(2, "0").toUpperCase()}${lb.toString(16).padStart(2, "0").toUpperCase()}`;
}

/**
 * Extract presentation style from master page theme, with slide-level fallback.
 *
 * @param presentation - Presentation data (must include masters with
 *   pageProperties.colorScheme and pageElements with placeholder text styles).
 *   When slides and layouts are included (with shapeProperties and text styles),
 *   they are used as a fallback for PPTX-converted files with empty master color schemes.
 * @returns PresentationStyle with theme colors and fonts
 */
export function extractPresentationStyle(
  presentation: Presentation
): PresentationStyle {
  const master = presentation.masters?.[0];
  if (!master) {
    // No master at all — try slide sampling if slides are available
    if (presentation.slides?.length || presentation.layouts?.length) {
      return extractStyleFromSlides(presentation.slides ?? [], presentation.layouts ?? []);
    }
    return { ...DEFAULT_STYLE };
  }

  // Extract theme colors from color scheme
  const colorMap = extractColorMap(master);
  const hasColors = Object.keys(colorMap).length > 0;

  // Extract fonts from placeholder text styles
  const fonts = extractFontsFromPlaceholders(master);

  // If master has a valid color scheme, use it
  if (hasColors) {
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

  // Master color scheme is empty — fall back to slide + layout sampling
  // Build a partial themeColorMap from whatever the master has (may be incomplete)
  const partialColorMap = extractColorMap(master);

  if (presentation.slides?.length || presentation.layouts?.length) {
    const slideStyle = extractStyleFromSlides(
      presentation.slides ?? [],
      presentation.layouts ?? [],
      partialColorMap
    );
    // Prefer master-level fonts if available
    if (fonts.heading) slideStyle.heading_font = fonts.heading;
    if (fonts.body) slideStyle.body_font = fonts.body;
    return slideStyle;
  }

  // Only fonts from master, no colors anywhere
  if (fonts.heading || fonts.body) {
    return {
      ...DEFAULT_STYLE,
      heading_font: fonts.heading ?? DEFAULT_STYLE.heading_font,
      body_font: fonts.body ?? DEFAULT_STYLE.body_font,
      source: "defaults",
    };
  }

  return { ...DEFAULT_STYLE };
}

/**
 * Extract style by sampling colors and fonts from actual slide and layout elements.
 *
 * Priority: page backgrounds > element fills > text colors.
 * Page backgrounds (e.g. maroon section dividers) are the most distinctive brand colors.
 */
function extractStyleFromSlides(
  slides: Page[],
  layouts: Page[] = [],
  themeColorMap: Record<string, string> = {}
): PresentationStyle {
  const pageBgCounts = new Map<string, number>();
  const colorCounts = new Map<string, number>();
  const textColorCounts = new Map<string, number>();
  const fontCounts = new Map<string, number>();
  const headingFontCounts = new Map<string, number>();

  // Scan both layouts and slides
  const allPages = [...layouts, ...slides];
  for (const page of allPages) {
    // Collect page background colors (high confidence brand colors)
    collectPageBackgrounds(page, pageBgCounts, themeColorMap);

    for (const element of page.pageElements ?? []) {
      collectElementColors(element, colorCounts, textColorCounts, themeColorMap);
      collectElementFonts(element, fontCounts, headingFontCounts);
    }
  }

  // Filter out generic colors and sort by frequency
  const significantPageBgs = [...pageBgCounts.entries()]
    .filter(([c]) => !GENERIC_COLORS.has(c))
    .sort((a, b) => b[1] - a[1])
    .map(([c]) => c);

  const significantColors = [...colorCounts.entries()]
    .filter(([c]) => !GENERIC_COLORS.has(c))
    .sort((a, b) => b[1] - a[1])
    .map(([c]) => c);

  const significantTextColors = [...textColorCounts.entries()]
    .filter(([c]) => !GENERIC_COLORS.has(c))
    .sort((a, b) => b[1] - a[1])
    .map(([c]) => c);

  const topFonts = [...fontCounts.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([f]) => f);

  const topHeadingFonts = [...headingFontCounts.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([f]) => f);

  // Merge all color sources: page backgrounds first (highest confidence), then element fills
  const allSignificantColors = [
    ...significantPageBgs,
    ...significantColors.filter((c) => !significantPageBgs.includes(c)),
  ];

  // Build style from sampled data
  const primaryColor = allSignificantColors[0] ?? DEFAULT_STYLE.primary_color;
  const accentColors = allSignificantColors.slice(1, 6);
  // Pad accent colors if we don't have enough
  while (accentColors.length < 5 && allSignificantColors.length > 0) {
    accentColors.push(lightenColor(primaryColor, 0.2 + accentColors.length * 0.15));
  }

  // For text colors: dark text colors (near black) are headings, medium are body
  const darkTextColors = significantTextColors.filter((c) => {
    const h = c.replace("#", "");
    const r = parseInt(h.substring(0, 2), 16);
    const g = parseInt(h.substring(2, 4), 16);
    const b = parseInt(h.substring(4, 6), 16);
    const luminance = (r + g + b) / 3;
    return luminance < 128;
  });

  return {
    primary_color: primaryColor,
    accent_colors: accentColors.length > 0 ? accentColors : DEFAULT_STYLE.accent_colors,
    heading_font: topHeadingFonts[0] ?? topFonts[0] ?? DEFAULT_STYLE.heading_font,
    body_font: topFonts[0] ?? DEFAULT_STYLE.body_font,
    heading_text_color: darkTextColors[0] ?? DEFAULT_STYLE.heading_text_color,
    body_text_color: darkTextColors[1] ?? darkTextColors[0] ?? DEFAULT_STYLE.body_text_color,
    background_color: "#FFFFFF",
    alt_background_color: primaryColor
      ? lightenColor(primaryColor, 0.9)
      : DEFAULT_STYLE.alt_background_color,
    source: "slide_sampling",
  };
}

/**
 * Resolve an OpaqueColor to a hex string.
 * Handles both rgbColor (direct) and themeColor (resolved via themeColorMap).
 */
function resolveOpaqueColor(
  opaque: { rgbColor?: { red?: number; green?: number; blue?: number }; themeColor?: string } | undefined,
  themeColorMap: Record<string, string>
): string | undefined {
  if (!opaque) return undefined;
  if (opaque.rgbColor) {
    return rgbToHex(opaque.rgbColor);
  }
  if (opaque.themeColor && themeColorMap[opaque.themeColor]) {
    return themeColorMap[opaque.themeColor];
  }
  return undefined;
}

/**
 * Collect page background colors from a page's pageProperties.
 * These are high-confidence template colors (e.g. maroon section divider backgrounds).
 */
function collectPageBackgrounds(
  page: Page,
  bgColors: Map<string, number>,
  themeColorMap: Record<string, string>
): void {
  const bgFill = page.pageProperties?.pageBackgroundFill;
  const opaque = bgFill?.solidFill?.color?.opaqueColor;
  const hex = resolveOpaqueColor(opaque, themeColorMap);
  if (hex) {
    bgColors.set(hex, (bgColors.get(hex) ?? 0) + 1);
  }
}

/**
 * Collect background fill colors and text foreground colors from an element.
 * Handles both rgbColor (direct values) and themeColor references (resolved via themeColorMap).
 */
function collectElementColors(
  element: PageElement,
  bgColors: Map<string, number>,
  textColors: Map<string, number>,
  themeColorMap: Record<string, string> = {}
): void {
  // Shape background fill
  const bgFill = element.shape?.shapeProperties?.shapeBackgroundFill;
  const bgOpaque = bgFill?.solidFill?.color?.opaqueColor;
  const bgHex = resolveOpaqueColor(bgOpaque, themeColorMap);
  if (bgHex) {
    bgColors.set(bgHex, (bgColors.get(bgHex) ?? 0) + 1);
  }

  // Text foreground colors
  const textElements = element.shape?.text?.textElements;
  if (textElements) {
    for (const te of textElements) {
      const fgOpaque = te.textRun?.style?.foregroundColor?.opaqueColor;
      const fgHex = resolveOpaqueColor(fgOpaque, themeColorMap);
      if (fgHex) {
        textColors.set(fgHex, (textColors.get(fgHex) ?? 0) + 1);
      }
    }
  }
}

/**
 * Collect font families from an element, distinguishing heading placeholders.
 */
function collectElementFonts(
  element: PageElement,
  bodyFonts: Map<string, number>,
  headingFonts: Map<string, number>
): void {
  const textElements = element.shape?.text?.textElements;
  if (!textElements) return;

  const isHeading =
    element.shape?.placeholder?.type === "TITLE" ||
    element.shape?.placeholder?.type === "CENTERED_TITLE";

  for (const te of textElements) {
    const font = te.textRun?.style?.fontFamily;
    if (font) {
      const target = isHeading ? headingFonts : bodyFonts;
      target.set(font, (target.get(font) ?? 0) + 1);
    }
  }
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
