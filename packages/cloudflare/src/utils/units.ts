/**
 * Unit conversion utilities for Google Slides API.
 *
 * Google Slides uses English Metric Units (EMU) for all positioning and sizing.
 * This module provides conversion functions between EMUs and human-friendly units.
 */

// EMU conversion constants
export const EMU_PER_INCH = 914400;
export const EMU_PER_POINT = 12700;
export const EMU_PER_CM = 360000;
export const EMU_PER_PIXEL_96DPI = 9525;

// Standard slide dimensions in EMU
// 16:9 Widescreen (Default)
export const SLIDE_WIDTH_EMU = 9144000; // 10 inches
export const SLIDE_HEIGHT_16_9_EMU = 5143500; // 5.625 inches

// 4:3 Standard
export const SLIDE_HEIGHT_4_3_EMU = 6858000; // 7.5 inches

// 16:10
export const SLIDE_HEIGHT_16_10_EMU = 5715000; // 6.25 inches

/**
 * Convert inches to EMU (English Metric Units).
 */
export function inchesToEmu(inches: number): number {
  return Math.round(inches * EMU_PER_INCH);
}

/**
 * Convert EMU to inches.
 */
export function emuToInches(emu: number): number {
  return emu / EMU_PER_INCH;
}

/**
 * Convert points to EMU.
 * Points are commonly used for font sizes.
 */
export function pointsToEmu(points: number): number {
  return Math.round(points * EMU_PER_POINT);
}

/**
 * Convert EMU to points.
 */
export function emuToPoints(emu: number): number {
  return emu / EMU_PER_POINT;
}

/**
 * Convert centimeters to EMU.
 */
export function cmToEmu(cm: number): number {
  return Math.round(cm * EMU_PER_CM);
}

/**
 * Convert EMU to centimeters.
 */
export function emuToCm(emu: number): number {
  return emu / EMU_PER_CM;
}

/**
 * Convert pixels to EMU at a given DPI.
 */
export function pixelsToEmu(pixels: number, dpi = 96): number {
  if (dpi === 96) {
    return Math.round(pixels * EMU_PER_PIXEL_96DPI);
  }
  return Math.round((pixels * EMU_PER_INCH) / dpi);
}

/**
 * Convert EMU to pixels at a given DPI.
 */
export function emuToPixels(emu: number, dpi = 96): number {
  if (dpi === 96) {
    return emu / EMU_PER_PIXEL_96DPI;
  }
  return (emu * dpi) / EMU_PER_INCH;
}
