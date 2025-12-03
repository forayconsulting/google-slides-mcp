/**
 * Color conversion utilities for Google Slides API.
 *
 * Google Slides uses RGB values in the 0-1 range.
 * This module provides conversion between hex colors and Google's RGB format.
 */

export interface RgbColor {
  red: number;
  green: number;
  blue: number;
}

export interface SolidFill {
  solidFill: {
    color: { rgbColor: RgbColor };
    alpha: number;
  };
}

/**
 * Convert hex color to Google Slides RGB format.
 *
 * Google Slides expects RGB values as floats in the 0-1 range.
 *
 * @param hexColor - Hex color string (e.g., "#FF5733" or "FF5733")
 * @returns Object with red, green, blue keys, values 0-1
 * @throws Error if hexColor is not a valid hex color string
 */
export function hexToRgb(hexColor: string): RgbColor {
  let hex = hexColor.replace(/^#/, "");

  if (hex.length === 3) {
    // Expand shorthand (e.g., "F53" -> "FF5533")
    hex = hex
      .split("")
      .map((c) => c + c)
      .join("");
  }

  if (hex.length !== 6) {
    throw new Error(`Invalid hex color: ${hexColor}`);
  }

  const r = parseInt(hex.substring(0, 2), 16);
  const g = parseInt(hex.substring(2, 4), 16);
  const b = parseInt(hex.substring(4, 6), 16);

  if (isNaN(r) || isNaN(g) || isNaN(b)) {
    throw new Error(`Invalid hex color: ${hexColor}`);
  }

  return {
    red: r / 255,
    green: g / 255,
    blue: b / 255,
  };
}

/**
 * Convert Google Slides RGB format to hex color.
 *
 * @param rgb - Object with red, green, blue keys, values 0-1
 * @returns Hex color string with # prefix (e.g., "#FF5733")
 * @throws Error if rgb values are out of range
 */
export function rgbToHex(rgb: Partial<RgbColor>): string {
  const r = rgb.red ?? 0;
  const g = rgb.green ?? 0;
  const b = rgb.blue ?? 0;

  // Validate range
  for (const [name, value] of [
    ["red", r],
    ["green", g],
    ["blue", b],
  ] as const) {
    if (value < 0 || value > 1) {
      throw new Error(`${name} value ${value} out of range [0, 1]`);
    }
  }

  // Convert to 0-255 range and format as hex
  const rInt = Math.round(r * 255);
  const gInt = Math.round(g * 255);
  const bInt = Math.round(b * 255);

  return `#${rInt.toString(16).padStart(2, "0").toUpperCase()}${gInt.toString(16).padStart(2, "0").toUpperCase()}${bInt.toString(16).padStart(2, "0").toUpperCase()}`;
}

/**
 * Create a Google Slides solidFill object from a hex color.
 *
 * @param hexColor - Hex color string
 * @param alpha - Opacity value 0-1 (default 1.0 = opaque)
 * @returns Object suitable for solidFill in Google Slides API
 */
export function rgbaToSolidFill(hexColor: string, alpha = 1.0): SolidFill {
  const rgb = hexToRgb(hexColor);
  return {
    solidFill: {
      color: { rgbColor: rgb },
      alpha,
    },
  };
}
