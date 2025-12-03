"""Transform calculation utilities for Google Slides API.

Google Slides uses affine transforms for positioning and sizing elements.
This module provides helpers for calculating transforms without manual EMU math.
"""

from dataclasses import dataclass
from typing import Literal

from google_slides_mcp.utils.units import (
    SLIDE_HEIGHT_16_9_EMU,
    SLIDE_HEIGHT_16_10_EMU,
    SLIDE_HEIGHT_4_3_EMU,
    SLIDE_WIDTH_EMU,
)


@dataclass
class SlideSize:
    """Represents slide dimensions in EMU."""

    width_emu: int
    height_emu: int

    @property
    def width_inches(self) -> float:
        """Width in inches."""
        from google_slides_mcp.utils.units import emu_to_inches

        return emu_to_inches(self.width_emu)

    @property
    def height_inches(self) -> float:
        """Height in inches."""
        from google_slides_mcp.utils.units import emu_to_inches

        return emu_to_inches(self.height_emu)


# Predefined slide sizes
SLIDE_SIZES: dict[str, SlideSize] = {
    "16:9": SlideSize(SLIDE_WIDTH_EMU, SLIDE_HEIGHT_16_9_EMU),
    "4:3": SlideSize(SLIDE_WIDTH_EMU, SLIDE_HEIGHT_4_3_EMU),
    "16:10": SlideSize(SLIDE_WIDTH_EMU, SLIDE_HEIGHT_16_10_EMU),
}


def calculate_center_position(
    slide_size: SlideSize,
    element_width_emu: int,
    element_height_emu: int,
) -> tuple[int, int]:
    """Calculate position to center an element on the slide.

    Args:
        slide_size: The slide dimensions
        element_width_emu: Element width in EMU
        element_height_emu: Element height in EMU

    Returns:
        Tuple of (x, y) position in EMU for centered placement
    """
    x = (slide_size.width_emu - element_width_emu) // 2
    y = (slide_size.height_emu - element_height_emu) // 2
    return x, y


def calculate_alignment_position(
    slide_size: SlideSize,
    element_width_emu: int,
    element_height_emu: int,
    horizontal: Literal["left", "center", "right"] | None = None,
    vertical: Literal["top", "center", "bottom"] | None = None,
    margin_emu: int = 0,
) -> tuple[int, int]:
    """Calculate position based on alignment preferences.

    Args:
        slide_size: The slide dimensions
        element_width_emu: Element width in EMU
        element_height_emu: Element height in EMU
        horizontal: Horizontal alignment (left, center, right)
        vertical: Vertical alignment (top, center, bottom)
        margin_emu: Margin from edges in EMU

    Returns:
        Tuple of (x, y) position in EMU
    """
    # Horizontal position
    if horizontal == "left":
        x = margin_emu
    elif horizontal == "center":
        x = (slide_size.width_emu - element_width_emu) // 2
    elif horizontal == "right":
        x = slide_size.width_emu - element_width_emu - margin_emu
    else:
        x = 0

    # Vertical position
    if vertical == "top":
        y = margin_emu
    elif vertical == "center":
        y = (slide_size.height_emu - element_height_emu) // 2
    elif vertical == "bottom":
        y = slide_size.height_emu - element_height_emu - margin_emu
    else:
        y = 0

    return x, y


def build_absolute_transform(
    translate_x_emu: int,
    translate_y_emu: int,
    scale_x: float = 1.0,
    scale_y: float = 1.0,
    rotation_angle: float = 0.0,
) -> dict:
    """Build an absolute transform for UpdatePageElementTransformRequest.

    Args:
        translate_x_emu: X translation in EMU
        translate_y_emu: Y translation in EMU
        scale_x: Horizontal scale factor (default 1.0)
        scale_y: Vertical scale factor (default 1.0)
        rotation_angle: Rotation in degrees (default 0.0)

    Returns:
        Transform dictionary suitable for Google Slides API

    Note:
        Rotation is not yet implemented - the angle parameter is reserved
        for future use. Currently only translation and scaling are supported.
    """
    # TODO: Implement rotation using shear values
    # For rotation, we'd need: shearX = -sin(angle), shearY = sin(angle)
    # and adjust scaleX/scaleY with cos(angle)
    if rotation_angle != 0.0:
        raise NotImplementedError("Rotation transforms are not yet supported")

    return {
        "scaleX": scale_x,
        "scaleY": scale_y,
        "shearX": 0,
        "shearY": 0,
        "translateX": translate_x_emu,
        "translateY": translate_y_emu,
        "unit": "EMU",
    }


def build_size(width_emu: int, height_emu: int) -> dict:
    """Build a size object for Google Slides API.

    Args:
        width_emu: Width in EMU
        height_emu: Height in EMU

    Returns:
        Size dictionary suitable for Google Slides API
    """
    return {
        "width": {"magnitude": width_emu, "unit": "EMU"},
        "height": {"magnitude": height_emu, "unit": "EMU"},
    }


def extract_element_bounds(page_element: dict) -> tuple[int, int, int, int]:
    """Extract position and size from a page element's transform.

    Args:
        page_element: A pageElement object from Google Slides API

    Returns:
        Tuple of (x, y, width, height) in EMU

    Raises:
        ValueError: If the element doesn't have transform or size information
    """
    transform = page_element.get("transform", {})
    size = page_element.get("size", {})

    if not transform or not size:
        raise ValueError("Page element missing transform or size information")

    x = int(transform.get("translateX", 0))
    y = int(transform.get("translateY", 0))
    width = int(size.get("width", {}).get("magnitude", 0))
    height = int(size.get("height", {}).get("magnitude", 0))

    return x, y, width, height
