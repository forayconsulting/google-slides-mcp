"""Composite slide-level tools for Google Slides.

High-level tools that create entire slides with content in one call,
automatically reading and applying the presentation's template theme.
"""

from __future__ import annotations

import uuid
from typing import TYPE_CHECKING

from fastmcp import Context

if TYPE_CHECKING:
    from fastmcp import FastMCP


def _unescape_text(text: str) -> str:
    """Unescape literal \\n and \\t sequences."""
    return text.replace("\\n", "\n").replace("\\t", "\t")


def _format_value(value: float) -> str:
    """Format large numbers with K/M/B suffixes."""
    if abs(value) >= 1_000_000_000:
        return f"{value / 1_000_000_000:.1f}B"
    if abs(value) >= 1_000_000:
        return f"{value / 1_000_000:.1f}M"
    if abs(value) >= 10_000:
        return f"{value / 1_000:.1f}K"
    if value == int(value):
        return str(int(value))
    return f"{value:.1f}"


def _generate_id(prefix: str) -> str:
    return f"{prefix}_{uuid.uuid4().hex[:8]}"


def _find_best_layout(layouts: list[dict], desired_type: str = "TITLE_ONLY") -> str | None:
    """Find the best matching layout from a list of presentation layouts."""
    if not layouts:
        return None

    title_only = None
    title_no_body = None
    with_title = None

    for layout in layouts:
        has_title = False
        has_body = False
        other_count = 0
        for el in layout.get("pageElements", []):
            p_type = el.get("shape", {}).get("placeholder", {}).get("type")
            if not p_type:
                continue
            if p_type in ("TITLE", "CENTERED_TITLE"):
                has_title = True
            elif p_type in ("BODY", "SUBTITLE"):
                has_body = True
            else:
                other_count += 1

        if desired_type == "TITLE_ONLY" and has_title and not has_body and other_count == 0:
            title_only = layout.get("objectId")
            break
        if desired_type == "TITLE_ONLY" and has_title and not has_body and not title_no_body:
            title_no_body = layout.get("objectId")
        if has_title and not with_title:
            with_title = layout.get("objectId")

    if desired_type == "BLANK":
        blank = next(
            (l for l in layouts if all(
                not el.get("shape", {}).get("placeholder")
                for el in l.get("pageElements", [])
            )),
            None,
        )
        return blank.get("objectId") if blank else (layouts[0].get("objectId") if layouts else None)

    return title_only or title_no_body or with_title or (layouts[0].get("objectId") if layouts else None)


async def _setup_slide(
    service,
    presentation_id: str,
    slide_id: str | None,
    title: str,
    subtitle: str | None = None,
) -> dict:
    """Create a TITLE_ONLY slide (or use existing) and set the title placeholder."""
    if slide_id:
        actual_slide_id = slide_id
    else:
        actual_slide_id = _generate_id("slide")
        try:
            await service.batch_update(presentation_id, [
                {
                    "createSlide": {
                        "objectId": actual_slide_id,
                        "slideLayoutReference": {"predefinedLayout": "TITLE_ONLY"},
                    }
                }
            ])
        except Exception:
            # Predefined layout failed (e.g. PPTX template) — discover layouts
            presentation = await service.get_presentation(
                presentation_id,
                fields="layouts(objectId,layoutProperties,pageElements.shape.placeholder)",
            )
            layout_id = _find_best_layout(presentation.get("layouts", []))
            layout_ref: dict = {"layoutId": layout_id} if layout_id else {"predefinedLayout": "BLANK"}
            await service.batch_update(presentation_id, [
                {
                    "createSlide": {
                        "objectId": actual_slide_id,
                        "slideLayoutReference": layout_ref,
                    }
                }
            ])

    # Get page to find placeholders
    page = await service.get_page(presentation_id, actual_slide_id)
    title_placeholder_id = None
    subtitle_placeholder_id = None

    for element in page.get("pageElements", []):
        placeholder = element.get("shape", {}).get("placeholder", {})
        ph_type = placeholder.get("type")
        if ph_type in ("TITLE", "CENTERED_TITLE"):
            title_placeholder_id = element.get("objectId")
        elif ph_type == "SUBTITLE":
            subtitle_placeholder_id = element.get("objectId")

    requests: list[dict] = []

    if title_placeholder_id:
        # Check for existing text
        title_element = next(
            (el for el in page.get("pageElements", [])
             if el.get("objectId") == title_placeholder_id),
            None,
        )
        if title_element:
            existing = "".join(
                te.get("textRun", {}).get("content", "")
                for te in title_element.get("shape", {}).get("text", {}).get("textElements", [])
            )
            if existing.strip():
                requests.append({
                    "deleteText": {
                        "objectId": title_placeholder_id,
                        "textRange": {"type": "ALL"},
                    }
                })
        requests.append({
            "insertText": {
                "objectId": title_placeholder_id,
                "text": _unescape_text(title),
                "insertionIndex": 0,
            }
        })

    if subtitle_placeholder_id and subtitle:
        sub_element = next(
            (el for el in page.get("pageElements", [])
             if el.get("objectId") == subtitle_placeholder_id),
            None,
        )
        if sub_element:
            existing = "".join(
                te.get("textRun", {}).get("content", "")
                for te in sub_element.get("shape", {}).get("text", {}).get("textElements", [])
            )
            if existing.strip():
                requests.append({
                    "deleteText": {
                        "objectId": subtitle_placeholder_id,
                        "textRange": {"type": "ALL"},
                    }
                })
        requests.append({
            "insertText": {
                "objectId": subtitle_placeholder_id,
                "text": _unescape_text(subtitle),
                "insertionIndex": 0,
            }
        })

    if requests:
        await service.batch_update(presentation_id, requests)

    return {
        "slide_id": actual_slide_id,
        "title_placeholder_id": title_placeholder_id,
        "subtitle_placeholder_id": subtitle_placeholder_id,
    }


def register_composite_tools(mcp: "FastMCP") -> None:
    """Register composite slide-level tools with the MCP application."""

    @mcp.tool()
    async def get_presentation_style(
        ctx: Context,
        presentation_id: str,
    ) -> dict:
        """Extract the presentation's theme colors and fonts from its master page.

        Returns a compact style object with primary/accent colors, heading/body fonts,
        and text colors. Use this when you need theme colors for atomic tools.

        Args:
            presentation_id: The presentation ID

        Returns:
            PresentationStyle with theme colors and fonts
        """
        from google_slides_mcp.auth.middleware import GoogleAuthMiddleware
        from google_slides_mcp.services.slides_service import SlidesService
        from google_slides_mcp.utils.style import STYLE_FIELDS, extract_presentation_style

        middleware = GoogleAuthMiddleware()
        credentials = await middleware.extract_credentials(ctx)
        service = SlidesService(credentials)

        presentation = await service.get_presentation(
            presentation_id, fields=STYLE_FIELDS
        )
        return extract_presentation_style(presentation)

    @mcp.tool()
    async def create_table_slide(
        ctx: Context,
        presentation_id: str,
        title: str,
        data: list[list[str]],
        slide_id: str | None = None,
        subtitle: str | None = None,
        header_row: bool = True,
    ) -> dict:
        """Create a complete table slide in one call.

        Automatically applies the presentation's theme colors to headers,
        zebra stripes, and text. Creates a TITLE_ONLY slide (or uses existing
        slide_id), sets the title via template placeholder, and builds a
        styled data table.

        Args:
            presentation_id: The presentation ID
            title: Slide title
            data: 2D array — first row is header
            slide_id: Use existing slide instead of creating new
            subtitle: Subtitle text
            header_row: Style first row as header

        Returns:
            Dictionary with slide_id, table_id, rows, columns, style_source
        """
        from google_slides_mcp.auth.middleware import GoogleAuthMiddleware
        from google_slides_mcp.services.slides_service import SlidesService
        from google_slides_mcp.utils.colors import hex_to_rgb
        from google_slides_mcp.utils.style import STYLE_FIELDS, extract_presentation_style
        from google_slides_mcp.utils.units import inches_to_emu

        middleware = GoogleAuthMiddleware()
        credentials = await middleware.extract_credentials(ctx)
        service = SlidesService(credentials)

        # Validate data
        if not data:
            raise ValueError("data must not be empty")
        col_count = len(data[0])
        if col_count == 0:
            raise ValueError("rows must have at least one column")
        for i, row in enumerate(data):
            if len(row) != col_count:
                raise ValueError(
                    f"row {i} has {len(row)} columns, expected {col_count}"
                )

        # Extract style
        presentation = await service.get_presentation(
            presentation_id, fields=STYLE_FIELDS
        )
        style = extract_presentation_style(presentation)

        # Create/setup slide
        setup = await _setup_slide(
            service, presentation_id, slide_id, title, subtitle
        )
        actual_slide_id = setup["slide_id"]

        # Table layout
        table_x, table_y, table_w = 0.5, 1.1, 9.0
        row_count = len(data)
        table_h = min(4.2, max(1.5, row_count * 0.4))

        table_id = _generate_id("table")

        # Create table
        await service.batch_update(presentation_id, [
            {
                "createTable": {
                    "objectId": table_id,
                    "rows": row_count,
                    "columns": col_count,
                    "elementProperties": {
                        "pageObjectId": actual_slide_id,
                        "size": {
                            "width": {"magnitude": inches_to_emu(table_w), "unit": "EMU"},
                            "height": {"magnitude": inches_to_emu(table_h), "unit": "EMU"},
                        },
                        "transform": {
                            "scaleX": 1, "scaleY": 1,
                            "shearX": 0, "shearY": 0,
                            "translateX": inches_to_emu(table_x),
                            "translateY": inches_to_emu(table_y),
                            "unit": "EMU",
                        },
                    },
                }
            }
        ])

        # Cell styling
        requests: list[dict] = []

        for row in range(row_count):
            for col in range(col_count):
                cell_text = _unescape_text(data[row][col])

                if cell_text:
                    requests.append({
                        "insertText": {
                            "objectId": table_id,
                            "cellLocation": {"rowIndex": row, "columnIndex": col},
                            "text": cell_text,
                            "insertionIndex": 0,
                        }
                    })

                is_header = header_row and row == 0
                text_color = style["background_color"] if is_header else style["heading_text_color"]
                requests.append({
                    "updateTextStyle": {
                        "objectId": table_id,
                        "cellLocation": {"rowIndex": row, "columnIndex": col},
                        "style": {
                            "fontFamily": style["body_font"],
                            "fontSize": {"magnitude": 13 if is_header else 12, "unit": "PT"},
                            "bold": is_header,
                            "foregroundColor": {
                                "opaqueColor": {"rgbColor": hex_to_rgb(text_color)}
                            },
                        },
                        "fields": "fontFamily,fontSize,bold,foregroundColor",
                        "textRange": {"type": "ALL"},
                    }
                })

                bg_color = None
                if is_header:
                    bg_color = style["primary_color"]
                elif row % 2 == 0:
                    bg_color = style["alt_background_color"]

                if bg_color:
                    requests.append({
                        "updateTableCellProperties": {
                            "objectId": table_id,
                            "tableRange": {
                                "location": {"rowIndex": row, "columnIndex": col},
                                "rowSpan": 1,
                                "columnSpan": 1,
                            },
                            "tableCellProperties": {
                                "tableCellBackgroundFill": {
                                    "solidFill": {
                                        "color": {"rgbColor": hex_to_rgb(bg_color)}
                                    }
                                }
                            },
                            "fields": "tableCellBackgroundFill",
                        }
                    })

        # Borders
        border_rgb = hex_to_rgb(style["alt_background_color"])
        border_def = {
            "tableBorderFill": {
                "solidFill": {"color": {"rgbColor": border_rgb}}
            },
            "weight": {"magnitude": 0.5, "unit": "PT"},
            "dashStyle": "SOLID",
        }

        for row in range(row_count):
            for col in range(col_count):
                requests.append({
                    "updateTableBorderProperties": {
                        "objectId": table_id,
                        "tableRange": {
                            "location": {"rowIndex": row, "columnIndex": col},
                            "rowSpan": 1,
                            "columnSpan": 1,
                        },
                        "tableBorderProperties": border_def,
                        "borderPosition": "ALL",
                        "fields": "tableBorderFill,weight,dashStyle",
                    }
                })

        if requests:
            await service.batch_update(presentation_id, requests)

        return {
            "slide_id": actual_slide_id,
            "table_id": table_id,
            "rows": row_count,
            "columns": col_count,
            "style_source": style["source"],
        }

    @mcp.tool()
    async def create_chart_slide(
        ctx: Context,
        presentation_id: str,
        title: str,
        labels: list[str],
        values: list[float],
        slide_id: str | None = None,
        chart_title: str | None = None,
        show_values: bool = True,
        multi_color: bool = False,
    ) -> dict:
        """Create a complete bar chart slide in one call.

        Automatically applies the presentation's theme colors to bars,
        labels, and text. Creates a TITLE_ONLY slide (or uses existing
        slide_id), sets the title via template placeholder, and builds
        a themed bar chart.

        Args:
            presentation_id: The presentation ID
            title: Slide title
            labels: Category labels
            values: Numeric values
            slide_id: Use existing slide instead of creating new
            chart_title: Title inside the chart area
            show_values: Show value labels above bars
            multi_color: Use ACCENT1-6 for different bars

        Returns:
            Dictionary with slide_id, element_ids, bar_count, style_source
        """
        from google_slides_mcp.auth.middleware import GoogleAuthMiddleware
        from google_slides_mcp.services.slides_service import SlidesService
        from google_slides_mcp.utils.colors import hex_to_rgb
        from google_slides_mcp.utils.style import STYLE_FIELDS, extract_presentation_style
        from google_slides_mcp.utils.units import inches_to_emu

        middleware = GoogleAuthMiddleware()
        credentials = await middleware.extract_credentials(ctx)
        service = SlidesService(credentials)

        if len(labels) != len(values):
            raise ValueError("labels and values must have the same length")
        if not labels:
            raise ValueError("must have at least one data point")
        max_value = max(values)
        if max_value <= 0:
            raise ValueError("at least one value must be positive")

        # Extract style
        presentation = await service.get_presentation(
            presentation_id, fields=STYLE_FIELDS
        )
        style = extract_presentation_style(presentation)

        # Create/setup slide
        setup = await _setup_slide(
            service, presentation_id, slide_id, title
        )
        actual_slide_id = setup["slide_id"]

        # Bar colors
        all_accent_colors = [style["primary_color"], *style["accent_colors"]]
        bar_colors = [
            all_accent_colors[i % len(all_accent_colors)] if multi_color
            else style["primary_color"]
            for i in range(len(labels))
        ]

        # Chart layout
        chart_x, chart_y = 0.5, 1.1
        chart_w, chart_h = 9.0, 4.2

        chart_title_height = 0.5 if chart_title else 0
        value_label_height = 0.35 if show_values else 0
        category_label_height = 0.35
        max_bar_height = chart_h - chart_title_height - value_label_height - category_label_height

        bar_count = len(labels)
        gap_ratio = 0.3
        bar_width = chart_w / (bar_count + (bar_count + 1) * gap_ratio)
        gap_width = bar_width * gap_ratio

        requests: list[dict] = []
        element_ids: list[str] = []

        # Chart title
        if chart_title:
            ct_id = _generate_id("chtitle")
            element_ids.append(ct_id)
            requests.extend([
                {
                    "createShape": {
                        "objectId": ct_id,
                        "shapeType": "TEXT_BOX",
                        "elementProperties": {
                            "pageObjectId": actual_slide_id,
                            "size": {
                                "width": {"magnitude": inches_to_emu(chart_w), "unit": "EMU"},
                                "height": {"magnitude": inches_to_emu(chart_title_height), "unit": "EMU"},
                            },
                            "transform": {
                                "scaleX": 1, "scaleY": 1, "shearX": 0, "shearY": 0,
                                "translateX": inches_to_emu(chart_x),
                                "translateY": inches_to_emu(chart_y),
                                "unit": "EMU",
                            },
                        },
                    }
                },
                {
                    "insertText": {
                        "objectId": ct_id,
                        "text": _unescape_text(chart_title),
                        "insertionIndex": 0,
                    }
                },
                {
                    "updateTextStyle": {
                        "objectId": ct_id,
                        "style": {
                            "fontFamily": style["heading_font"],
                            "fontSize": {"magnitude": 14, "unit": "PT"},
                            "bold": True,
                            "foregroundColor": {
                                "opaqueColor": {"rgbColor": hex_to_rgb(style["heading_text_color"])}
                            },
                        },
                        "fields": "fontFamily,fontSize,bold,foregroundColor",
                        "textRange": {"type": "ALL"},
                    }
                },
                {
                    "updateParagraphStyle": {
                        "objectId": ct_id,
                        "style": {"alignment": "CENTER"},
                        "fields": "alignment",
                        "textRange": {"type": "ALL"},
                    }
                },
            ])

        # Bars + labels
        for i in range(bar_count):
            bar_x = chart_x + gap_width + i * (bar_width + gap_width)
            bar_height = max((values[i] / max_value) * max_bar_height, 0.02)
            bar_y = chart_y + chart_title_height + value_label_height + (max_bar_height - bar_height)

            # Bar
            bar_id = _generate_id("bar")
            element_ids.append(bar_id)
            requests.extend([
                {
                    "createShape": {
                        "objectId": bar_id,
                        "shapeType": "RECTANGLE",
                        "elementProperties": {
                            "pageObjectId": actual_slide_id,
                            "size": {
                                "width": {"magnitude": inches_to_emu(bar_width), "unit": "EMU"},
                                "height": {"magnitude": inches_to_emu(bar_height), "unit": "EMU"},
                            },
                            "transform": {
                                "scaleX": 1, "scaleY": 1, "shearX": 0, "shearY": 0,
                                "translateX": inches_to_emu(bar_x),
                                "translateY": inches_to_emu(bar_y),
                                "unit": "EMU",
                            },
                        },
                    }
                },
                {
                    "updateShapeProperties": {
                        "objectId": bar_id,
                        "shapeProperties": {
                            "shapeBackgroundFill": {
                                "solidFill": {"color": {"rgbColor": hex_to_rgb(bar_colors[i])}}
                            },
                            "outline": {"propertyState": "NOT_RENDERED"},
                        },
                        "fields": "shapeBackgroundFill,outline",
                    }
                },
            ])

            # Value label
            if show_values:
                val_id = _generate_id("val")
                element_ids.append(val_id)
                val_label_y = bar_y - value_label_height
                requests.extend([
                    {
                        "createShape": {
                            "objectId": val_id,
                            "shapeType": "TEXT_BOX",
                            "elementProperties": {
                                "pageObjectId": actual_slide_id,
                                "size": {
                                    "width": {"magnitude": inches_to_emu(bar_width), "unit": "EMU"},
                                    "height": {"magnitude": inches_to_emu(value_label_height), "unit": "EMU"},
                                },
                                "transform": {
                                    "scaleX": 1, "scaleY": 1, "shearX": 0, "shearY": 0,
                                    "translateX": inches_to_emu(bar_x),
                                    "translateY": inches_to_emu(val_label_y),
                                    "unit": "EMU",
                                },
                            },
                        }
                    },
                    {
                        "insertText": {
                            "objectId": val_id,
                            "text": _format_value(values[i]),
                            "insertionIndex": 0,
                        }
                    },
                    {
                        "updateTextStyle": {
                            "objectId": val_id,
                            "style": {
                                "fontFamily": style["body_font"],
                                "fontSize": {"magnitude": 10, "unit": "PT"},
                                "bold": True,
                                "foregroundColor": {
                                    "opaqueColor": {"rgbColor": hex_to_rgb(style["body_text_color"])}
                                },
                            },
                            "fields": "fontFamily,fontSize,bold,foregroundColor",
                            "textRange": {"type": "ALL"},
                        }
                    },
                    {
                        "updateParagraphStyle": {
                            "objectId": val_id,
                            "style": {"alignment": "CENTER"},
                            "fields": "alignment",
                            "textRange": {"type": "ALL"},
                        }
                    },
                ])

            # Category label
            cat_id = _generate_id("cat")
            element_ids.append(cat_id)
            cat_label_y = chart_y + chart_title_height + value_label_height + max_bar_height
            requests.extend([
                {
                    "createShape": {
                        "objectId": cat_id,
                        "shapeType": "TEXT_BOX",
                        "elementProperties": {
                            "pageObjectId": actual_slide_id,
                            "size": {
                                "width": {"magnitude": inches_to_emu(bar_width + gap_width), "unit": "EMU"},
                                "height": {"magnitude": inches_to_emu(category_label_height), "unit": "EMU"},
                            },
                            "transform": {
                                "scaleX": 1, "scaleY": 1, "shearX": 0, "shearY": 0,
                                "translateX": inches_to_emu(bar_x - gap_width / 2),
                                "translateY": inches_to_emu(cat_label_y),
                                "unit": "EMU",
                            },
                        },
                    }
                },
                {
                    "insertText": {
                        "objectId": cat_id,
                        "text": _unescape_text(labels[i]),
                        "insertionIndex": 0,
                    }
                },
                {
                    "updateTextStyle": {
                        "objectId": cat_id,
                        "style": {
                            "fontFamily": style["body_font"],
                            "fontSize": {"magnitude": 10, "unit": "PT"},
                            "foregroundColor": {
                                "opaqueColor": {"rgbColor": hex_to_rgb(style["body_text_color"])}
                            },
                        },
                        "fields": "fontFamily,fontSize,foregroundColor",
                        "textRange": {"type": "ALL"},
                    }
                },
                {
                    "updateParagraphStyle": {
                        "objectId": cat_id,
                        "style": {"alignment": "CENTER"},
                        "fields": "alignment",
                        "textRange": {"type": "ALL"},
                    }
                },
            ])

        await service.batch_update(presentation_id, requests)

        return {
            "slide_id": actual_slide_id,
            "element_ids": element_ids,
            "bar_count": bar_count,
            "style_source": style["source"],
        }

    @mcp.tool()
    async def create_dashboard_slide(
        ctx: Context,
        presentation_id: str,
        title: str,
        metrics: list[dict],
        slide_id: str | None = None,
        show_card_background: bool = True,
    ) -> dict:
        """Create a complete KPI dashboard slide in one call.

        Automatically applies the presentation's theme colors. Creates a
        TITLE_ONLY slide (or uses existing slide_id), sets the title via
        template placeholder, and arranges 1-8 metric cards in an
        auto-calculated grid.

        Args:
            presentation_id: The presentation ID
            title: Slide title
            metrics: 1-8 metric cards, each with 'value', 'label', and optional 'description'
            slide_id: Use existing slide instead of creating new
            show_card_background: Show card background rectangles

        Returns:
            Dictionary with slide_id, element_ids, metric_count, grid, style_source
        """
        from google_slides_mcp.auth.middleware import GoogleAuthMiddleware
        from google_slides_mcp.services.slides_service import SlidesService
        from google_slides_mcp.utils.colors import hex_to_rgb
        from google_slides_mcp.utils.style import STYLE_FIELDS, extract_presentation_style
        from google_slides_mcp.utils.units import inches_to_emu

        middleware = GoogleAuthMiddleware()
        credentials = await middleware.extract_credentials(ctx)
        service = SlidesService(credentials)

        if not metrics or len(metrics) > 8:
            raise ValueError("metrics must have 1-8 items")

        # Extract style
        presentation = await service.get_presentation(
            presentation_id, fields=STYLE_FIELDS
        )
        style = extract_presentation_style(presentation)

        # Create/setup slide
        setup = await _setup_slide(
            service, presentation_id, slide_id, title
        )
        actual_slide_id = setup["slide_id"]

        # Grid layout
        content_x, content_y = 0.5, 1.1
        content_w, content_h = 9.0, 4.2
        gap = 0.25

        count = len(metrics)
        if count <= 4:
            rows, cols = 1, count
        elif count <= 6:
            rows, cols = 2, 3
        else:
            rows, cols = 2, 4

        card_w = (content_w - gap * (cols - 1)) / cols
        card_h = (content_h - gap * (rows - 1)) / rows

        stat_font_size = 44 if count <= 4 else 36 if count <= 6 else 30
        label_font_size = 14 if count <= 4 else 12
        desc_font_size = 11 if count <= 4 else 10

        requests: list[dict] = []
        element_ids: list[str] = []

        for i, metric in enumerate(metrics):
            row_idx = i // cols
            col_idx = i % cols

            # Center last row if incomplete
            row_offset = 0.0
            is_last_row = row_idx == rows - 1
            items_in_last_row = count - (rows - 1) * cols
            if is_last_row and items_in_last_row < cols:
                row_offset = ((cols - items_in_last_row) * (card_w + gap)) / 2

            card_x = content_x + row_offset + col_idx * (card_w + gap)
            card_y = content_y + row_idx * (card_h + gap)

            # Background card
            if show_card_background:
                bg_id = _generate_id("cardbg")
                element_ids.append(bg_id)
                requests.extend([
                    {
                        "createShape": {
                            "objectId": bg_id,
                            "shapeType": "ROUND_RECTANGLE",
                            "elementProperties": {
                                "pageObjectId": actual_slide_id,
                                "size": {
                                    "width": {"magnitude": inches_to_emu(card_w), "unit": "EMU"},
                                    "height": {"magnitude": inches_to_emu(card_h), "unit": "EMU"},
                                },
                                "transform": {
                                    "scaleX": 1, "scaleY": 1, "shearX": 0, "shearY": 0,
                                    "translateX": inches_to_emu(card_x),
                                    "translateY": inches_to_emu(card_y),
                                    "unit": "EMU",
                                },
                            },
                        }
                    },
                    {
                        "updateShapeProperties": {
                            "objectId": bg_id,
                            "shapeProperties": {
                                "shapeBackgroundFill": {
                                    "solidFill": {
                                        "color": {"rgbColor": hex_to_rgb(style["alt_background_color"])}
                                    }
                                },
                                "outline": {"propertyState": "NOT_RENDERED"},
                            },
                            "fields": "shapeBackgroundFill,outline",
                        }
                    },
                ])

            # Layout within card
            padding = 0.15
            inner_w = card_w - padding * 2
            stat_h = card_h * 0.5
            label_h = card_h * 0.2
            desc_h = card_h * 0.2 if metric.get("description") else 0

            # Stat value
            stat_id = _generate_id("statval")
            element_ids.append(stat_id)
            requests.extend([
                {
                    "createShape": {
                        "objectId": stat_id,
                        "shapeType": "TEXT_BOX",
                        "elementProperties": {
                            "pageObjectId": actual_slide_id,
                            "size": {
                                "width": {"magnitude": inches_to_emu(inner_w), "unit": "EMU"},
                                "height": {"magnitude": inches_to_emu(stat_h), "unit": "EMU"},
                            },
                            "transform": {
                                "scaleX": 1, "scaleY": 1, "shearX": 0, "shearY": 0,
                                "translateX": inches_to_emu(card_x + padding),
                                "translateY": inches_to_emu(card_y + padding),
                                "unit": "EMU",
                            },
                        },
                    }
                },
                {
                    "insertText": {
                        "objectId": stat_id,
                        "text": _unescape_text(str(metric["value"])),
                        "insertionIndex": 0,
                    }
                },
                {
                    "updateTextStyle": {
                        "objectId": stat_id,
                        "style": {
                            "fontFamily": style["heading_font"],
                            "fontSize": {"magnitude": stat_font_size, "unit": "PT"},
                            "bold": True,
                            "foregroundColor": {
                                "opaqueColor": {"rgbColor": hex_to_rgb(style["primary_color"])}
                            },
                        },
                        "fields": "fontFamily,fontSize,bold,foregroundColor",
                        "textRange": {"type": "ALL"},
                    }
                },
                {
                    "updateParagraphStyle": {
                        "objectId": stat_id,
                        "style": {"alignment": "CENTER"},
                        "fields": "alignment",
                        "textRange": {"type": "ALL"},
                    }
                },
            ])

            # Label
            lbl_id = _generate_id("statlbl")
            element_ids.append(lbl_id)
            label_y = card_y + padding + stat_h
            requests.extend([
                {
                    "createShape": {
                        "objectId": lbl_id,
                        "shapeType": "TEXT_BOX",
                        "elementProperties": {
                            "pageObjectId": actual_slide_id,
                            "size": {
                                "width": {"magnitude": inches_to_emu(inner_w), "unit": "EMU"},
                                "height": {"magnitude": inches_to_emu(label_h), "unit": "EMU"},
                            },
                            "transform": {
                                "scaleX": 1, "scaleY": 1, "shearX": 0, "shearY": 0,
                                "translateX": inches_to_emu(card_x + padding),
                                "translateY": inches_to_emu(label_y),
                                "unit": "EMU",
                            },
                        },
                    }
                },
                {
                    "insertText": {
                        "objectId": lbl_id,
                        "text": _unescape_text(str(metric["label"])),
                        "insertionIndex": 0,
                    }
                },
                {
                    "updateTextStyle": {
                        "objectId": lbl_id,
                        "style": {
                            "fontFamily": style["body_font"],
                            "fontSize": {"magnitude": label_font_size, "unit": "PT"},
                            "foregroundColor": {
                                "opaqueColor": {"rgbColor": hex_to_rgb(style["body_text_color"])}
                            },
                        },
                        "fields": "fontFamily,fontSize,foregroundColor",
                        "textRange": {"type": "ALL"},
                    }
                },
                {
                    "updateParagraphStyle": {
                        "objectId": lbl_id,
                        "style": {"alignment": "CENTER"},
                        "fields": "alignment",
                        "textRange": {"type": "ALL"},
                    }
                },
            ])

            # Description
            if metric.get("description"):
                desc_id = _generate_id("statdsc")
                element_ids.append(desc_id)
                desc_y = label_y + label_h
                requests.extend([
                    {
                        "createShape": {
                            "objectId": desc_id,
                            "shapeType": "TEXT_BOX",
                            "elementProperties": {
                                "pageObjectId": actual_slide_id,
                                "size": {
                                    "width": {"magnitude": inches_to_emu(inner_w), "unit": "EMU"},
                                    "height": {"magnitude": inches_to_emu(desc_h), "unit": "EMU"},
                                },
                                "transform": {
                                    "scaleX": 1, "scaleY": 1, "shearX": 0, "shearY": 0,
                                    "translateX": inches_to_emu(card_x + padding),
                                    "translateY": inches_to_emu(desc_y),
                                    "unit": "EMU",
                                },
                            },
                        }
                    },
                    {
                        "insertText": {
                            "objectId": desc_id,
                            "text": _unescape_text(str(metric["description"])),
                            "insertionIndex": 0,
                        }
                    },
                    {
                        "updateTextStyle": {
                            "objectId": desc_id,
                            "style": {
                                "fontFamily": style["body_font"],
                                "fontSize": {"magnitude": desc_font_size, "unit": "PT"},
                                "italic": True,
                                "foregroundColor": {
                                    "opaqueColor": {"rgbColor": hex_to_rgb(style["body_text_color"])}
                                },
                            },
                            "fields": "fontFamily,fontSize,italic,foregroundColor",
                            "textRange": {"type": "ALL"},
                        }
                    },
                    {
                        "updateParagraphStyle": {
                            "objectId": desc_id,
                            "style": {"alignment": "CENTER"},
                            "fields": "alignment",
                            "textRange": {"type": "ALL"},
                        }
                    },
                ])

        await service.batch_update(presentation_id, requests)

        return {
            "slide_id": actual_slide_id,
            "element_ids": element_ids,
            "metric_count": count,
            "grid": f"{rows}x{cols}",
            "style_source": style["source"],
        }
