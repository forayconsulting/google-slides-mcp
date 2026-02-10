"""Style extraction utilities for Google Slides presentations.

Extracts theme colors and fonts from a presentation's master page,
providing a compact style object for composite tools.
"""

from __future__ import annotations

from typing import Any, TypedDict

from google_slides_mcp.utils.colors import rgb_to_hex


class PresentationStyle(TypedDict):
    primary_color: str
    accent_colors: list[str]
    heading_font: str
    body_font: str
    heading_text_color: str
    body_text_color: str
    background_color: str
    alt_background_color: str
    source: str  # "theme" or "defaults"


DEFAULT_STYLE: PresentationStyle = {
    "primary_color": "#1a73e8",
    "accent_colors": ["#ea4335", "#fbbc04", "#34a853", "#4285f4", "#ff6d01"],
    "heading_font": "Arial",
    "body_font": "Arial",
    "heading_text_color": "#202124",
    "body_text_color": "#5f6368",
    "background_color": "#FFFFFF",
    "alt_background_color": "#F8F9FA",
    "source": "defaults",
}

# Theme color type names from the Google Slides API
THEME_COLOR_TYPES = frozenset({
    "DARK1", "LIGHT1", "DARK2", "LIGHT2",
    "ACCENT1", "ACCENT2", "ACCENT3", "ACCENT4", "ACCENT5", "ACCENT6",
})

# Field mask for style extraction
STYLE_FIELDS = (
    "masters.pageProperties.colorScheme,"
    "masters.pageElements.shape.placeholder,"
    "masters.pageElements.shape.text.textElements.textRun.style"
)


def extract_presentation_style(presentation: dict[str, Any]) -> PresentationStyle:
    """Extract presentation style from master page theme.

    Args:
        presentation: Presentation data (must include masters with
            pageProperties.colorScheme and pageElements with placeholder text styles)

    Returns:
        PresentationStyle with theme colors and fonts
    """
    masters = presentation.get("masters", [])
    if not masters:
        return {**DEFAULT_STYLE}

    master = masters[0]
    color_map = _extract_color_map(master)
    has_colors = bool(color_map)
    fonts = _extract_fonts_from_placeholders(master)

    if not has_colors and not fonts.get("heading") and not fonts.get("body"):
        return {**DEFAULT_STYLE}

    accent_colors = [
        color_map[f"ACCENT{i}"]
        for i in range(2, 7)
        if f"ACCENT{i}" in color_map
    ]

    return {
        "primary_color": color_map.get("ACCENT1", DEFAULT_STYLE["primary_color"]),
        "accent_colors": accent_colors if accent_colors else DEFAULT_STYLE["accent_colors"],
        "heading_font": fonts.get("heading", DEFAULT_STYLE["heading_font"]),
        "body_font": fonts.get("body", DEFAULT_STYLE["body_font"]),
        "heading_text_color": color_map.get("DARK1", DEFAULT_STYLE["heading_text_color"]),
        "body_text_color": color_map.get("DARK2", DEFAULT_STYLE["body_text_color"]),
        "background_color": color_map.get("LIGHT1", DEFAULT_STYLE["background_color"]),
        "alt_background_color": color_map.get("LIGHT2", DEFAULT_STYLE["alt_background_color"]),
        "source": "theme",
    }


def _extract_color_map(master: dict[str, Any]) -> dict[str, str]:
    """Extract theme color map from a master page's color scheme."""
    colors = (
        master
        .get("pageProperties", {})
        .get("colorScheme", {})
        .get("colors", [])
    )

    color_map: dict[str, str] = {}
    for pair in colors:
        color_type = pair.get("type")
        rgb_color = pair.get("color", {}).get("rgbColor")
        if color_type and color_type in THEME_COLOR_TYPES and rgb_color:
            color_map[color_type] = rgb_to_hex(rgb_color)

    return color_map


def _extract_fonts_from_placeholders(
    master: dict[str, Any],
) -> dict[str, str]:
    """Extract heading and body fonts from master page placeholders."""
    result: dict[str, str] = {}

    for element in master.get("pageElements", []):
        placeholder = element.get("shape", {}).get("placeholder")
        if not placeholder:
            continue

        font = _get_first_text_run_font(element)
        if not font:
            continue

        ph_type = placeholder.get("type")
        if ph_type in ("TITLE", "CENTERED_TITLE") and "heading" not in result:
            result["heading"] = font
        elif ph_type in ("BODY", "SUBTITLE") and "body" not in result:
            result["body"] = font

    return result


def _get_first_text_run_font(element: dict[str, Any]) -> str | None:
    """Get the font family from the first text run in an element."""
    text_elements = (
        element
        .get("shape", {})
        .get("text", {})
        .get("textElements", [])
    )

    for te in text_elements:
        font = te.get("textRun", {}).get("style", {}).get("fontFamily")
        if font:
            return font

    return None
