"""Utility modules for Google Slides MCP Server."""

from google_slides_mcp.utils.colors import hex_to_rgb, rgb_to_hex
from google_slides_mcp.utils.transforms import (
    SlideSize,
    build_absolute_transform,
    calculate_alignment_position,
    calculate_center_position,
)
from google_slides_mcp.utils.units import (
    EMU_PER_CM,
    EMU_PER_INCH,
    EMU_PER_PIXEL_96DPI,
    EMU_PER_POINT,
    SLIDE_HEIGHT_16_9_EMU,
    SLIDE_HEIGHT_4_3_EMU,
    SLIDE_WIDTH_EMU,
    emu_to_inches,
    emu_to_points,
    inches_to_emu,
    points_to_emu,
)

__all__ = [
    # Units
    "EMU_PER_INCH",
    "EMU_PER_POINT",
    "EMU_PER_CM",
    "EMU_PER_PIXEL_96DPI",
    "SLIDE_WIDTH_EMU",
    "SLIDE_HEIGHT_16_9_EMU",
    "SLIDE_HEIGHT_4_3_EMU",
    "inches_to_emu",
    "emu_to_inches",
    "points_to_emu",
    "emu_to_points",
    # Colors
    "hex_to_rgb",
    "rgb_to_hex",
    # Transforms
    "SlideSize",
    "calculate_center_position",
    "calculate_alignment_position",
    "build_absolute_transform",
]
