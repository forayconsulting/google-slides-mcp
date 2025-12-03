"""Color conversion utilities for Google Slides API.

Google Slides uses RGB values in the 0-1 range.
This module provides conversion between hex colors and Google's RGB format.
"""


def hex_to_rgb(hex_color: str) -> dict[str, float]:
    """Convert hex color to Google Slides RGB format.

    Google Slides expects RGB values as floats in the 0-1 range.

    Args:
        hex_color: Hex color string (e.g., "#FF5733" or "FF5733")

    Returns:
        Dictionary with "red", "green", "blue" keys, values 0-1

    Raises:
        ValueError: If hex_color is not a valid hex color string
    """
    hex_color = hex_color.lstrip("#")

    if len(hex_color) == 3:
        # Expand shorthand (e.g., "F53" -> "FF5533")
        hex_color = "".join(c * 2 for c in hex_color)

    if len(hex_color) != 6:
        raise ValueError(f"Invalid hex color: {hex_color}")

    try:
        r = int(hex_color[0:2], 16) / 255
        g = int(hex_color[2:4], 16) / 255
        b = int(hex_color[4:6], 16) / 255
    except ValueError as e:
        raise ValueError(f"Invalid hex color: {hex_color}") from e

    return {"red": r, "green": g, "blue": b}


def rgb_to_hex(rgb: dict[str, float]) -> str:
    """Convert Google Slides RGB format to hex color.

    Args:
        rgb: Dictionary with "red", "green", "blue" keys, values 0-1

    Returns:
        Hex color string with # prefix (e.g., "#FF5733")

    Raises:
        ValueError: If rgb values are out of range
    """
    r = rgb.get("red", 0)
    g = rgb.get("green", 0)
    b = rgb.get("blue", 0)

    # Validate range
    for name, value in [("red", r), ("green", g), ("blue", b)]:
        if not 0 <= value <= 1:
            raise ValueError(f"{name} value {value} out of range [0, 1]")

    # Convert to 0-255 range and format as hex
    r_int = int(round(r * 255))
    g_int = int(round(g * 255))
    b_int = int(round(b * 255))

    return f"#{r_int:02X}{g_int:02X}{b_int:02X}"


def rgba_to_solid_fill(hex_color: str, alpha: float = 1.0) -> dict:
    """Create a Google Slides solidFill object from a hex color.

    Args:
        hex_color: Hex color string
        alpha: Opacity value 0-1 (default 1.0 = opaque)

    Returns:
        Dictionary suitable for solidFill in Google Slides API
    """
    rgb = hex_to_rgb(hex_color)
    return {
        "solidFill": {
            "color": {"rgbColor": rgb},
            "alpha": alpha,
        }
    }
