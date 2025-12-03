/**
 * Transform calculation utilities for Google Slides API.
 *
 * Google Slides uses affine transforms for positioning and sizing elements.
 * This module provides helpers for calculating transforms without manual EMU math.
 */

import {
  SLIDE_HEIGHT_16_9_EMU,
  SLIDE_HEIGHT_16_10_EMU,
  SLIDE_HEIGHT_4_3_EMU,
  SLIDE_WIDTH_EMU,
  emuToInches,
} from "./units.js";

/**
 * Represents slide dimensions in EMU.
 */
export interface SlideSize {
  widthEmu: number;
  heightEmu: number;
}

/**
 * Get slide size with inch accessors.
 */
export function getSlideSizeInches(size: SlideSize): {
  widthInches: number;
  heightInches: number;
} {
  return {
    widthInches: emuToInches(size.widthEmu),
    heightInches: emuToInches(size.heightEmu),
  };
}

/**
 * Predefined slide sizes.
 */
export const SLIDE_SIZES: Record<string, SlideSize> = {
  "16:9": { widthEmu: SLIDE_WIDTH_EMU, heightEmu: SLIDE_HEIGHT_16_9_EMU },
  "4:3": { widthEmu: SLIDE_WIDTH_EMU, heightEmu: SLIDE_HEIGHT_4_3_EMU },
  "16:10": { widthEmu: SLIDE_WIDTH_EMU, heightEmu: SLIDE_HEIGHT_16_10_EMU },
};

export type HorizontalAlignment = "left" | "center" | "right";
export type VerticalAlignment = "top" | "center" | "bottom";

/**
 * Calculate position to center an element on the slide.
 *
 * @param slideSize - The slide dimensions
 * @param elementWidthEmu - Element width in EMU
 * @param elementHeightEmu - Element height in EMU
 * @returns Tuple of [x, y] position in EMU for centered placement
 */
export function calculateCenterPosition(
  slideSize: SlideSize,
  elementWidthEmu: number,
  elementHeightEmu: number
): [number, number] {
  const x = Math.floor((slideSize.widthEmu - elementWidthEmu) / 2);
  const y = Math.floor((slideSize.heightEmu - elementHeightEmu) / 2);
  return [x, y];
}

/**
 * Calculate position based on alignment preferences.
 *
 * @param slideSize - The slide dimensions
 * @param elementWidthEmu - Element width in EMU
 * @param elementHeightEmu - Element height in EMU
 * @param horizontal - Horizontal alignment (left, center, right)
 * @param vertical - Vertical alignment (top, center, bottom)
 * @param marginEmu - Margin from edges in EMU
 * @returns Tuple of [x, y] position in EMU
 */
export function calculateAlignmentPosition(
  slideSize: SlideSize,
  elementWidthEmu: number,
  elementHeightEmu: number,
  horizontal?: HorizontalAlignment | null,
  vertical?: VerticalAlignment | null,
  marginEmu = 0
): [number, number] {
  let x: number;
  let y: number;

  // Horizontal position
  if (horizontal === "left") {
    x = marginEmu;
  } else if (horizontal === "center") {
    x = Math.floor((slideSize.widthEmu - elementWidthEmu) / 2);
  } else if (horizontal === "right") {
    x = slideSize.widthEmu - elementWidthEmu - marginEmu;
  } else {
    x = 0;
  }

  // Vertical position
  if (vertical === "top") {
    y = marginEmu;
  } else if (vertical === "center") {
    y = Math.floor((slideSize.heightEmu - elementHeightEmu) / 2);
  } else if (vertical === "bottom") {
    y = slideSize.heightEmu - elementHeightEmu - marginEmu;
  } else {
    y = 0;
  }

  return [x, y];
}

export interface AffineTransform {
  scaleX: number;
  scaleY: number;
  shearX: number;
  shearY: number;
  translateX: number;
  translateY: number;
  unit: "EMU";
}

/**
 * Build an absolute transform for UpdatePageElementTransformRequest.
 *
 * @param translateXEmu - X translation in EMU
 * @param translateYEmu - Y translation in EMU
 * @param scaleX - Horizontal scale factor (default 1.0)
 * @param scaleY - Vertical scale factor (default 1.0)
 * @param rotationAngle - Rotation in degrees (default 0.0) - NOT YET IMPLEMENTED
 * @returns Transform object suitable for Google Slides API
 * @throws Error if rotation is requested (not yet supported)
 */
export function buildAbsoluteTransform(
  translateXEmu: number,
  translateYEmu: number,
  scaleX = 1.0,
  scaleY = 1.0,
  rotationAngle = 0.0
): AffineTransform {
  // TODO: Implement rotation using shear values
  // For rotation, we'd need: shearX = -sin(angle), shearY = sin(angle)
  // and adjust scaleX/scaleY with cos(angle)
  if (rotationAngle !== 0.0) {
    throw new Error("Rotation transforms are not yet supported");
  }

  return {
    scaleX,
    scaleY,
    shearX: 0,
    shearY: 0,
    translateX: translateXEmu,
    translateY: translateYEmu,
    unit: "EMU",
  };
}

export interface SizeObject {
  width: { magnitude: number; unit: "EMU" };
  height: { magnitude: number; unit: "EMU" };
}

/**
 * Build a size object for Google Slides API.
 *
 * @param widthEmu - Width in EMU
 * @param heightEmu - Height in EMU
 * @returns Size object suitable for Google Slides API
 */
export function buildSize(widthEmu: number, heightEmu: number): SizeObject {
  return {
    width: { magnitude: widthEmu, unit: "EMU" },
    height: { magnitude: heightEmu, unit: "EMU" },
  };
}

export interface ElementBounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

/**
 * Extract position and size from a page element's transform.
 *
 * The actual rendered size is the intrinsic size multiplied by the scale
 * factors from the transform matrix.
 *
 * @param pageElement - A pageElement object from Google Slides API
 * @returns Object with x, y, width, height in EMU where width/height are the
 *          actual rendered dimensions (intrinsic size * scale)
 * @throws Error if the element doesn't have transform or size information
 */
export function extractElementBounds(pageElement: {
  transform?: Record<string, unknown>;
  size?: {
    width?: { magnitude?: number };
    height?: { magnitude?: number };
  };
}): ElementBounds {
  const transform = pageElement.transform ?? {};
  const size = pageElement.size ?? {};

  if (Object.keys(transform).length === 0 || Object.keys(size).length === 0) {
    throw new Error("Page element missing transform or size information");
  }

  const x = Number(transform.translateX ?? 0);
  const y = Number(transform.translateY ?? 0);

  // Intrinsic size from the size object
  const intrinsicWidth = size.width?.magnitude ?? 0;
  const intrinsicHeight = size.height?.magnitude ?? 0;

  // Scale factors from the transform (default to 1.0 if not present)
  const scaleX = Number(transform.scaleX ?? 1.0);
  const scaleY = Number(transform.scaleY ?? 1.0);

  // Actual rendered size = intrinsic size * scale
  const width = Math.floor(intrinsicWidth * Math.abs(scaleX));
  const height = Math.floor(intrinsicHeight * Math.abs(scaleY));

  return { x, y, width, height };
}
