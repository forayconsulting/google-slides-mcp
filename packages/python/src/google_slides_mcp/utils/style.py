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
    source: str  # "theme", "slide_sampling", or "defaults"


DEFAULT_STYLE: PresentationStyle = {
    "primary_color": "#054950",
    "accent_colors": ["#C84F09", "#6A1933", "#2B3F60", "#92E5B7", "#B699E1"],
    "heading_font": "Nunito Sans",
    "body_font": "Nunito Sans",
    "heading_text_color": "#054950",
    "body_text_color": "#3C4043",
    "background_color": "#FFFFFF",
    "alt_background_color": "#F0FAFA",
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
    "masters.pageElements.shape.text.textElements.textRun.style,"
    "slides.pageProperties.pageBackgroundFill,"
    "slides.pageElements.shape.placeholder,"
    "slides.pageElements.shape.shapeProperties.shapeBackgroundFill,"
    "slides.pageElements.shape.text.textElements.textRun.style,"
    "layouts.objectId,"
    "layouts.layoutProperties,"
    "layouts.pageProperties.pageBackgroundFill,"
    "layouts.pageElements.shape.placeholder,"
    "layouts.pageElements.shape.shapeProperties.shapeBackgroundFill,"
    "layouts.pageElements.shape.text.textElements.textRun.style"
)

GENERIC_COLORS = frozenset({
    "#FFFFFF", "#000000", "#F8F9FA", "#F1F3F4",
    "#E8EAED", "#DADCE0", "#BDC1C6", "#9AA0A6",
    "#80868B", "#5F6368", "#3C4043", "#202124",
})


def extract_presentation_style(presentation: dict[str, Any]) -> PresentationStyle:
    """Extract presentation style from master page theme.

    Falls back to slide sampling for PPTX-converted presentations
    where the master color scheme may be empty.

    Args:
        presentation: Presentation data (must include masters with
            pageProperties.colorScheme and pageElements with placeholder text styles)

    Returns:
        PresentationStyle with theme colors and fonts
    """
    masters = presentation.get("masters", [])
    if not masters:
        # No master -- try slide sampling
        slides = presentation.get("slides", [])
        layouts = presentation.get("layouts", [])
        if slides or layouts:
            return _extract_style_from_slides(slides, layouts)
        return {**DEFAULT_STYLE}

    master = masters[0]
    color_map = _extract_color_map(master)
    has_colors = bool(color_map)
    fonts = _extract_fonts_from_placeholders(master)

    if has_colors:
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

    # Master color scheme empty -- fall back to slide sampling
    partial_color_map = color_map  # may be incomplete
    slides = presentation.get("slides", [])
    layouts = presentation.get("layouts", [])
    if slides or layouts:
        style = _extract_style_from_slides(slides, layouts, partial_color_map)
        if fonts.get("heading"):
            style["heading_font"] = fonts["heading"]
        if fonts.get("body"):
            style["body_font"] = fonts["body"]
        return style

    # Only fonts, no colors
    if fonts.get("heading") or fonts.get("body"):
        return {
            **DEFAULT_STYLE,
            "heading_font": fonts.get("heading", DEFAULT_STYLE["heading_font"]),
            "body_font": fonts.get("body", DEFAULT_STYLE["body_font"]),
            "source": "defaults",
        }

    return {**DEFAULT_STYLE}


def _lighten_color(hex_color: str, amount: float) -> str:
    """Lighten a hex color by a given amount (0.0 to 1.0)."""
    h = hex_color.lstrip("#")
    r = int(h[0:2], 16)
    g = int(h[2:4], 16)
    b = int(h[4:6], 16)
    lr = round(r + (255 - r) * amount)
    lg = round(g + (255 - g) * amount)
    lb = round(b + (255 - b) * amount)
    return f"#{lr:02X}{lg:02X}{lb:02X}"


def _is_dark(hex_color: str) -> bool:
    """Check if a hex color is dark (average RGB < 128)."""
    h = hex_color.lstrip("#")
    r = int(h[0:2], 16)
    g = int(h[2:4], 16)
    b = int(h[4:6], 16)
    return (r + g + b) / 3 < 128


def _resolve_opaque_color(
    opaque: dict[str, Any] | None,
    theme_color_map: dict[str, str] | None = None,
) -> str | None:
    """Resolve an opaqueColor object to a hex string."""
    if not opaque:
        return None
    rgb = opaque.get("rgbColor")
    if rgb:
        return rgb_to_hex(rgb)
    theme_color = opaque.get("themeColor")
    if theme_color and theme_color_map and theme_color in theme_color_map:
        return theme_color_map[theme_color]
    return None


def _extract_style_from_slides(
    slides: list[dict[str, Any]],
    layouts: list[dict[str, Any]],
    theme_color_map: dict[str, str] | None = None,
) -> PresentationStyle:
    """Extract style by sampling colors/fonts from actual slide and layout elements."""
    if theme_color_map is None:
        theme_color_map = {}

    page_bg_counts: dict[str, int] = {}
    color_counts: dict[str, int] = {}
    text_color_counts: dict[str, int] = {}
    font_counts: dict[str, int] = {}
    heading_font_counts: dict[str, int] = {}

    all_pages = [*layouts, *slides]
    for page in all_pages:
        # Page backgrounds
        bg_fill = page.get("pageProperties", {}).get("pageBackgroundFill", {})
        opaque = bg_fill.get("solidFill", {}).get("color", {}).get("opaqueColor")
        hex_color = _resolve_opaque_color(opaque, theme_color_map)
        if hex_color:
            page_bg_counts[hex_color] = page_bg_counts.get(hex_color, 0) + 1

        # Element colors and fonts
        for element in page.get("pageElements", []):
            # Shape background fill
            shape_bg = (element.get("shape", {})
                        .get("shapeProperties", {})
                        .get("shapeBackgroundFill", {}))
            bg_opaque = shape_bg.get("solidFill", {}).get("color", {}).get("opaqueColor")
            bg_hex = _resolve_opaque_color(bg_opaque, theme_color_map)
            if bg_hex:
                color_counts[bg_hex] = color_counts.get(bg_hex, 0) + 1

            # Text colors and fonts
            is_heading = (element.get("shape", {})
                         .get("placeholder", {})
                         .get("type") in ("TITLE", "CENTERED_TITLE"))
            for te in (element.get("shape", {})
                       .get("text", {})
                       .get("textElements", [])):
                style = te.get("textRun", {}).get("style", {})
                fg_opaque = style.get("foregroundColor", {}).get("opaqueColor")
                fg_hex = _resolve_opaque_color(fg_opaque, theme_color_map)
                if fg_hex:
                    text_color_counts[fg_hex] = text_color_counts.get(fg_hex, 0) + 1
                font = style.get("fontFamily")
                if font:
                    target = heading_font_counts if is_heading else font_counts
                    target[font] = target.get(font, 0) + 1

    # Filter and sort
    sig_page_bgs = [c for c, _ in sorted(
        ((c, n) for c, n in page_bg_counts.items() if c not in GENERIC_COLORS),
        key=lambda x: -x[1],
    )]
    sig_colors = [c for c, _ in sorted(
        ((c, n) for c, n in color_counts.items() if c not in GENERIC_COLORS),
        key=lambda x: -x[1],
    )]
    sig_text_colors = [c for c, _ in sorted(
        ((c, n) for c, n in text_color_counts.items() if c not in GENERIC_COLORS),
        key=lambda x: -x[1],
    )]
    top_fonts = [f for f, _ in sorted(font_counts.items(), key=lambda x: -x[1])]
    top_heading_fonts = [f for f, _ in sorted(
        heading_font_counts.items(), key=lambda x: -x[1],
    )]

    # Merge: page backgrounds first (highest confidence), then element fills
    all_sig = sig_page_bgs + [c for c in sig_colors if c not in sig_page_bgs]

    primary_color = all_sig[0] if all_sig else DEFAULT_STYLE["primary_color"]
    accent_colors = list(all_sig[1:6])
    while len(accent_colors) < 5 and all_sig:
        accent_colors.append(
            _lighten_color(primary_color, 0.2 + len(accent_colors) * 0.15)
        )

    dark_text = [c for c in sig_text_colors if _is_dark(c)]

    return {
        "primary_color": primary_color,
        "accent_colors": accent_colors if accent_colors else DEFAULT_STYLE["accent_colors"],
        "heading_font": (
            top_heading_fonts[0] if top_heading_fonts
            else (top_fonts[0] if top_fonts else DEFAULT_STYLE["heading_font"])
        ),
        "body_font": top_fonts[0] if top_fonts else DEFAULT_STYLE["body_font"],
        "heading_text_color": (
            dark_text[0] if dark_text else DEFAULT_STYLE["heading_text_color"]
        ),
        "body_text_color": (
            dark_text[1] if len(dark_text) > 1
            else (dark_text[0] if dark_text else DEFAULT_STYLE["body_text_color"])
        ),
        "background_color": "#FFFFFF",
        "alt_background_color": (
            _lighten_color(primary_color, 0.9)
            if primary_color else DEFAULT_STYLE["alt_background_color"]
        ),
        "source": "slide_sampling",
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
