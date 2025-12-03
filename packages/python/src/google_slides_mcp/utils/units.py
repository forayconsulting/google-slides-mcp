"""Unit conversion utilities for Google Slides API.

Google Slides uses English Metric Units (EMU) for all positioning and sizing.
This module provides conversion functions between EMUs and human-friendly units.
"""

# EMU conversion constants
EMU_PER_INCH = 914400
EMU_PER_POINT = 12700
EMU_PER_CM = 360000
EMU_PER_PIXEL_96DPI = 9525

# Standard slide dimensions in EMU
# 16:9 Widescreen (Default)
SLIDE_WIDTH_EMU = 9144000  # 10 inches
SLIDE_HEIGHT_16_9_EMU = 5143500  # 5.625 inches

# 4:3 Standard
SLIDE_HEIGHT_4_3_EMU = 6858000  # 7.5 inches

# 16:10
SLIDE_HEIGHT_16_10_EMU = 5715000  # 6.25 inches


def inches_to_emu(inches: float) -> int:
    """Convert inches to EMU (English Metric Units).

    Args:
        inches: Value in inches

    Returns:
        Equivalent value in EMU as an integer
    """
    return int(inches * EMU_PER_INCH)


def emu_to_inches(emu: int) -> float:
    """Convert EMU to inches.

    Args:
        emu: Value in EMU

    Returns:
        Equivalent value in inches
    """
    return emu / EMU_PER_INCH


def points_to_emu(points: float) -> int:
    """Convert points to EMU.

    Points are commonly used for font sizes.

    Args:
        points: Value in points

    Returns:
        Equivalent value in EMU as an integer
    """
    return int(points * EMU_PER_POINT)


def emu_to_points(emu: int) -> float:
    """Convert EMU to points.

    Args:
        emu: Value in EMU

    Returns:
        Equivalent value in points
    """
    return emu / EMU_PER_POINT


def cm_to_emu(cm: float) -> int:
    """Convert centimeters to EMU.

    Args:
        cm: Value in centimeters

    Returns:
        Equivalent value in EMU as an integer
    """
    return int(cm * EMU_PER_CM)


def emu_to_cm(emu: int) -> float:
    """Convert EMU to centimeters.

    Args:
        emu: Value in EMU

    Returns:
        Equivalent value in centimeters
    """
    return emu / EMU_PER_CM


def pixels_to_emu(pixels: float, dpi: int = 96) -> int:
    """Convert pixels to EMU at a given DPI.

    Args:
        pixels: Value in pixels
        dpi: Dots per inch (default 96)

    Returns:
        Equivalent value in EMU as an integer
    """
    if dpi == 96:
        return int(pixels * EMU_PER_PIXEL_96DPI)
    return int(pixels * EMU_PER_INCH / dpi)


def emu_to_pixels(emu: int, dpi: int = 96) -> float:
    """Convert EMU to pixels at a given DPI.

    Args:
        emu: Value in EMU
        dpi: Dots per inch (default 96)

    Returns:
        Equivalent value in pixels
    """
    if dpi == 96:
        return emu / EMU_PER_PIXEL_96DPI
    return emu * dpi / EMU_PER_INCH
