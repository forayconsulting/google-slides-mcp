"""Visualization tools for Google Slides.

Higher-level tools for creating tables, charts, and stat callouts
that produce professional visual elements in a single call.
"""

from typing import TYPE_CHECKING, Literal
import uuid

from fastmcp import Context

if TYPE_CHECKING:
    from fastmcp import FastMCP


def _unescape_text(text: str) -> str:
    """Unescape literal \\n and \\t sequences that LLMs sometimes double-escape."""
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


def register_visualization_tools(mcp: "FastMCP") -> None:
    """Register visualization tools with the MCP application."""

    @mcp.tool()
    async def add_table(
        ctx: Context,
        presentation_id: str,
        slide_id: str,
        data: list[list[str]],
        x: float = 0.5,
        y: float = 0.8,
        width: float = 9.0,
        height: float = 3.5,
        header_row: bool = True,
        header_color: str = "#1a73e8",
        header_text_color: str = "#FFFFFF",
        alternate_row_color: str | None = None,
        border_color: str = "#DADCE0",
        border_weight: float = 0.5,
        font_size: int = 12,
        font_family: str = "Arial",
    ) -> dict:
        """Create a styled data table on a slide.

        Supports header row styling, zebra striping, and custom borders.

        Args:
            presentation_id: The presentation ID
            slide_id: The slide to add the table to
            data: 2D array of cell data - first row is header if header_row is true
            x: X position in inches
            y: Y position in inches
            width: Table width in inches
            height: Table height in inches
            header_row: Style first row as header
            header_color: Header background color hex
            header_text_color: Header text color hex
            alternate_row_color: Zebra stripe color for alternating rows
            border_color: Border color hex
            border_weight: Border weight in points
            font_size: Body text font size in points
            font_family: Font family

        Returns:
            Dictionary with element_id, rows, columns
        """
        from google_slides_mcp.auth.middleware import GoogleAuthMiddleware
        from google_slides_mcp.services.slides_service import SlidesService
        from google_slides_mcp.utils.colors import hex_to_rgb
        from google_slides_mcp.utils.units import inches_to_emu

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

        middleware = GoogleAuthMiddleware()
        credentials = await middleware.extract_credentials(ctx)
        service = SlidesService(credentials)

        table_id = f"table_{uuid.uuid4().hex[:8]}"
        row_count = len(data)

        # Step 1: Create the table
        await service.batch_update(presentation_id, [
            {
                "createTable": {
                    "objectId": table_id,
                    "rows": row_count,
                    "columns": col_count,
                    "elementProperties": {
                        "pageObjectId": slide_id,
                        "size": {
                            "width": {"magnitude": inches_to_emu(width), "unit": "EMU"},
                            "height": {"magnitude": inches_to_emu(height), "unit": "EMU"},
                        },
                        "transform": {
                            "scaleX": 1,
                            "scaleY": 1,
                            "shearX": 0,
                            "shearY": 0,
                            "translateX": inches_to_emu(x),
                            "translateY": inches_to_emu(y),
                            "unit": "EMU",
                        },
                    },
                },
            },
        ])

        # Step 2: Insert text, style cells, set borders
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
                        },
                    })

                is_header = header_row and row == 0
                text_color = header_text_color if is_header else "#000000"
                requests.append({
                    "updateTextStyle": {
                        "objectId": table_id,
                        "cellLocation": {"rowIndex": row, "columnIndex": col},
                        "style": {
                            "fontFamily": font_family,
                            "fontSize": {
                                "magnitude": font_size + 1 if is_header else font_size,
                                "unit": "PT",
                            },
                            "bold": is_header,
                            "foregroundColor": {
                                "opaqueColor": {"rgbColor": hex_to_rgb(text_color)},
                            },
                        },
                        "fields": "fontFamily,fontSize,bold,foregroundColor",
                        "textRange": {"type": "ALL"},
                    },
                })

                bg_color = None
                if is_header:
                    bg_color = header_color
                elif alternate_row_color and row % 2 == 0:
                    bg_color = alternate_row_color

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
                                        "color": {"rgbColor": hex_to_rgb(bg_color)},
                                    },
                                },
                            },
                            "fields": "tableCellBackgroundFill",
                        },
                    })

        # Set border properties
        border_rgb = hex_to_rgb(border_color)
        border_def = {
            "tableBorderFill": {
                "solidFill": {"color": {"rgbColor": border_rgb}},
            },
            "weight": {"magnitude": border_weight, "unit": "PT"},
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
                    },
                })

        if requests:
            await service.batch_update(presentation_id, requests)

        return {
            "element_id": table_id,
            "rows": row_count,
            "columns": col_count,
        }

    @mcp.tool()
    async def add_bar_chart(
        ctx: Context,
        presentation_id: str,
        slide_id: str,
        labels: list[str],
        values: list[float],
        title: str | None = None,
        color: str = "#1a73e8",
        x: float = 0.5,
        y: float = 0.8,
        width: float = 9.0,
        height: float = 4.0,
        show_values: bool = True,
        bar_color_scale: list[str] | None = None,
    ) -> dict:
        """Create a bar chart using shapes. No Google Sheets dependency.

        Renders directly on the slide with proportionally-scaled bars.

        Args:
            presentation_id: The presentation ID
            slide_id: The slide to add the chart to
            labels: Category labels for each bar
            values: Numeric values for each bar
            title: Chart title
            color: Bar fill color
            x: X position in inches
            y: Y position in inches
            width: Total chart width in inches
            height: Total chart height in inches
            show_values: Show value labels above bars
            bar_color_scale: Per-bar colors (overrides color)

        Returns:
            Dictionary with element_ids and bar_count
        """
        from google_slides_mcp.auth.middleware import GoogleAuthMiddleware
        from google_slides_mcp.services.slides_service import SlidesService
        from google_slides_mcp.utils.colors import hex_to_rgb
        from google_slides_mcp.utils.units import inches_to_emu

        if len(labels) != len(values):
            raise ValueError("labels and values must have the same length")
        if len(labels) == 0:
            raise ValueError("must have at least one data point")
        max_value = max(values)
        if max_value <= 0:
            raise ValueError("at least one value must be positive")
        if bar_color_scale and len(bar_color_scale) != len(labels):
            raise ValueError("bar_color_scale must match labels length")

        middleware = GoogleAuthMiddleware()
        credentials = await middleware.extract_credentials(ctx)
        service = SlidesService(credentials)

        requests: list[dict] = []
        element_ids: list[str] = []

        title_height = 0.5 if title else 0
        value_label_height = 0.35 if show_values else 0
        category_label_height = 0.35
        chart_area_x = x
        chart_area_y = y + title_height
        chart_area_width = width
        max_bar_height = height - title_height - value_label_height - category_label_height

        bar_count = len(labels)
        gap_ratio = 0.3
        bar_width = chart_area_width / (bar_count + (bar_count + 1) * gap_ratio)
        gap_width = bar_width * gap_ratio

        # Optional title
        if title:
            title_id = f"charttitle_{uuid.uuid4().hex[:8]}"
            element_ids.append(title_id)
            requests.extend([
                {
                    "createShape": {
                        "objectId": title_id,
                        "shapeType": "TEXT_BOX",
                        "elementProperties": {
                            "pageObjectId": slide_id,
                            "size": {
                                "width": {"magnitude": inches_to_emu(width), "unit": "EMU"},
                                "height": {"magnitude": inches_to_emu(title_height), "unit": "EMU"},
                            },
                            "transform": {
                                "scaleX": 1, "scaleY": 1, "shearX": 0, "shearY": 0,
                                "translateX": inches_to_emu(x),
                                "translateY": inches_to_emu(y),
                                "unit": "EMU",
                            },
                        },
                    },
                },
                {
                    "insertText": {
                        "objectId": title_id,
                        "text": _unescape_text(title),
                        "insertionIndex": 0,
                    },
                },
                {
                    "updateTextStyle": {
                        "objectId": title_id,
                        "style": {
                            "fontFamily": "Arial",
                            "fontSize": {"magnitude": 16, "unit": "PT"},
                            "bold": True,
                            "foregroundColor": {"opaqueColor": {"rgbColor": hex_to_rgb("#333333")}},
                        },
                        "fields": "fontFamily,fontSize,bold,foregroundColor",
                        "textRange": {"type": "ALL"},
                    },
                },
                {
                    "updateParagraphStyle": {
                        "objectId": title_id,
                        "style": {"alignment": "CENTER"},
                        "fields": "alignment",
                        "textRange": {"type": "ALL"},
                    },
                },
            ])

        for i in range(bar_count):
            bar_x = chart_area_x + gap_width + i * (bar_width + gap_width)
            bar_height = max((values[i] / max_value) * max_bar_height, 0.02)
            bar_y = chart_area_y + value_label_height + (max_bar_height - bar_height)
            bar_color = bar_color_scale[i] if bar_color_scale else color

            # Bar rectangle
            bar_id = f"bar_{uuid.uuid4().hex[:8]}"
            element_ids.append(bar_id)
            requests.extend([
                {
                    "createShape": {
                        "objectId": bar_id,
                        "shapeType": "RECTANGLE",
                        "elementProperties": {
                            "pageObjectId": slide_id,
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
                    },
                },
                {
                    "updateShapeProperties": {
                        "objectId": bar_id,
                        "shapeProperties": {
                            "shapeBackgroundFill": {
                                "solidFill": {"color": {"rgbColor": hex_to_rgb(bar_color)}},
                            },
                            "outline": {"propertyState": "NOT_RENDERED"},
                        },
                        "fields": "shapeBackgroundFill,outline",
                    },
                },
            ])

            # Value label above bar
            if show_values:
                val_label_id = f"val_{uuid.uuid4().hex[:8]}"
                element_ids.append(val_label_id)
                val_label_y = bar_y - value_label_height
                requests.extend([
                    {
                        "createShape": {
                            "objectId": val_label_id,
                            "shapeType": "TEXT_BOX",
                            "elementProperties": {
                                "pageObjectId": slide_id,
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
                        },
                    },
                    {
                        "insertText": {
                            "objectId": val_label_id,
                            "text": _format_value(values[i]),
                            "insertionIndex": 0,
                        },
                    },
                    {
                        "updateTextStyle": {
                            "objectId": val_label_id,
                            "style": {
                                "fontFamily": "Arial",
                                "fontSize": {"magnitude": 10, "unit": "PT"},
                                "bold": True,
                                "foregroundColor": {"opaqueColor": {"rgbColor": hex_to_rgb("#555555")}},
                            },
                            "fields": "fontFamily,fontSize,bold,foregroundColor",
                            "textRange": {"type": "ALL"},
                        },
                    },
                    {
                        "updateParagraphStyle": {
                            "objectId": val_label_id,
                            "style": {"alignment": "CENTER"},
                            "fields": "alignment",
                            "textRange": {"type": "ALL"},
                        },
                    },
                ])

            # Category label below bar
            cat_label_id = f"cat_{uuid.uuid4().hex[:8]}"
            element_ids.append(cat_label_id)
            cat_label_y = chart_area_y + value_label_height + max_bar_height
            requests.extend([
                {
                    "createShape": {
                        "objectId": cat_label_id,
                        "shapeType": "TEXT_BOX",
                        "elementProperties": {
                            "pageObjectId": slide_id,
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
                    },
                },
                {
                    "insertText": {
                        "objectId": cat_label_id,
                        "text": _unescape_text(labels[i]),
                        "insertionIndex": 0,
                    },
                },
                {
                    "updateTextStyle": {
                        "objectId": cat_label_id,
                        "style": {
                            "fontFamily": "Arial",
                            "fontSize": {"magnitude": 10, "unit": "PT"},
                            "foregroundColor": {"opaqueColor": {"rgbColor": hex_to_rgb("#666666")}},
                        },
                        "fields": "fontFamily,fontSize,foregroundColor",
                        "textRange": {"type": "ALL"},
                    },
                },
                {
                    "updateParagraphStyle": {
                        "objectId": cat_label_id,
                        "style": {"alignment": "CENTER"},
                        "fields": "alignment",
                        "textRange": {"type": "ALL"},
                    },
                },
            ])

        await service.batch_update(presentation_id, requests)

        return {
            "element_ids": element_ids,
            "bar_count": bar_count,
        }

    @mcp.tool()
    async def add_stat_callout(
        ctx: Context,
        presentation_id: str,
        slide_id: str,
        stat_value: str,
        label: str,
        description: str | None = None,
        x: float = 1.0,
        y: float = 1.0,
        width: float = 2.5,
        height: float = 2.0,
        color: str = "#1a73e8",
        background_color: str | None = None,
        stat_font_size: int = 48,
        label_font_size: int = 14,
    ) -> dict:
        """Create a KPI/metric display card with a large stat value, label, and optional description.

        Use for dashboards and summary slides.

        Args:
            presentation_id: The presentation ID
            slide_id: The slide to add the callout to
            stat_value: Main stat value (e.g., '3.5M', '99.9%')
            label: Label below the stat (e.g., 'Active Users')
            description: Optional context line (e.g., 'Up 25% YoY')
            x: X position in inches
            y: Y position in inches
            width: Card width in inches
            height: Card height in inches
            color: Accent color for stat value
            background_color: Card background color (None = transparent)
            stat_font_size: Stat value font size in points
            label_font_size: Label font size in points

        Returns:
            Dictionary with element_ids
        """
        from google_slides_mcp.auth.middleware import GoogleAuthMiddleware
        from google_slides_mcp.services.slides_service import SlidesService
        from google_slides_mcp.utils.colors import hex_to_rgb
        from google_slides_mcp.utils.units import inches_to_emu

        middleware = GoogleAuthMiddleware()
        credentials = await middleware.extract_credentials(ctx)
        service = SlidesService(credentials)

        requests: list[dict] = []
        element_ids: list[str] = []

        # Background card
        if background_color:
            bg_id = f"statbg_{uuid.uuid4().hex[:8]}"
            element_ids.append(bg_id)
            requests.extend([
                {
                    "createShape": {
                        "objectId": bg_id,
                        "shapeType": "ROUND_RECTANGLE",
                        "elementProperties": {
                            "pageObjectId": slide_id,
                            "size": {
                                "width": {"magnitude": inches_to_emu(width), "unit": "EMU"},
                                "height": {"magnitude": inches_to_emu(height), "unit": "EMU"},
                            },
                            "transform": {
                                "scaleX": 1, "scaleY": 1, "shearX": 0, "shearY": 0,
                                "translateX": inches_to_emu(x),
                                "translateY": inches_to_emu(y),
                                "unit": "EMU",
                            },
                        },
                    },
                },
                {
                    "updateShapeProperties": {
                        "objectId": bg_id,
                        "shapeProperties": {
                            "shapeBackgroundFill": {
                                "solidFill": {"color": {"rgbColor": hex_to_rgb(background_color)}},
                            },
                            "outline": {"propertyState": "NOT_RENDERED"},
                        },
                        "fields": "shapeBackgroundFill,outline",
                    },
                },
            ])

        padding = 0.15
        inner_width = width - padding * 2
        stat_height = height * 0.5
        label_height = height * 0.2
        desc_height = height * 0.2 if description else 0

        # Stat value
        stat_id = f"statval_{uuid.uuid4().hex[:8]}"
        element_ids.append(stat_id)
        requests.extend([
            {
                "createShape": {
                    "objectId": stat_id,
                    "shapeType": "TEXT_BOX",
                    "elementProperties": {
                        "pageObjectId": slide_id,
                        "size": {
                            "width": {"magnitude": inches_to_emu(inner_width), "unit": "EMU"},
                            "height": {"magnitude": inches_to_emu(stat_height), "unit": "EMU"},
                        },
                        "transform": {
                            "scaleX": 1, "scaleY": 1, "shearX": 0, "shearY": 0,
                            "translateX": inches_to_emu(x + padding),
                            "translateY": inches_to_emu(y + padding),
                            "unit": "EMU",
                        },
                    },
                },
            },
            {
                "insertText": {
                    "objectId": stat_id,
                    "text": _unescape_text(stat_value),
                    "insertionIndex": 0,
                },
            },
            {
                "updateTextStyle": {
                    "objectId": stat_id,
                    "style": {
                        "fontFamily": "Arial",
                        "fontSize": {"magnitude": stat_font_size, "unit": "PT"},
                        "bold": True,
                        "foregroundColor": {"opaqueColor": {"rgbColor": hex_to_rgb(color)}},
                    },
                    "fields": "fontFamily,fontSize,bold,foregroundColor",
                    "textRange": {"type": "ALL"},
                },
            },
            {
                "updateParagraphStyle": {
                    "objectId": stat_id,
                    "style": {"alignment": "CENTER"},
                    "fields": "alignment",
                    "textRange": {"type": "ALL"},
                },
            },
        ])

        # Label
        label_id = f"statlbl_{uuid.uuid4().hex[:8]}"
        element_ids.append(label_id)
        label_y = y + padding + stat_height
        requests.extend([
            {
                "createShape": {
                    "objectId": label_id,
                    "shapeType": "TEXT_BOX",
                    "elementProperties": {
                        "pageObjectId": slide_id,
                        "size": {
                            "width": {"magnitude": inches_to_emu(inner_width), "unit": "EMU"},
                            "height": {"magnitude": inches_to_emu(label_height), "unit": "EMU"},
                        },
                        "transform": {
                            "scaleX": 1, "scaleY": 1, "shearX": 0, "shearY": 0,
                            "translateX": inches_to_emu(x + padding),
                            "translateY": inches_to_emu(label_y),
                            "unit": "EMU",
                        },
                    },
                },
            },
            {
                "insertText": {
                    "objectId": label_id,
                    "text": _unescape_text(label),
                    "insertionIndex": 0,
                },
            },
            {
                "updateTextStyle": {
                    "objectId": label_id,
                    "style": {
                        "fontFamily": "Arial",
                        "fontSize": {"magnitude": label_font_size, "unit": "PT"},
                        "foregroundColor": {"opaqueColor": {"rgbColor": hex_to_rgb("#666666")}},
                    },
                    "fields": "fontFamily,fontSize,foregroundColor",
                    "textRange": {"type": "ALL"},
                },
            },
            {
                "updateParagraphStyle": {
                    "objectId": label_id,
                    "style": {"alignment": "CENTER"},
                    "fields": "alignment",
                    "textRange": {"type": "ALL"},
                },
            },
        ])

        # Optional description
        if description:
            desc_id = f"statdesc_{uuid.uuid4().hex[:8]}"
            element_ids.append(desc_id)
            desc_y = label_y + label_height
            requests.extend([
                {
                    "createShape": {
                        "objectId": desc_id,
                        "shapeType": "TEXT_BOX",
                        "elementProperties": {
                            "pageObjectId": slide_id,
                            "size": {
                                "width": {"magnitude": inches_to_emu(inner_width), "unit": "EMU"},
                                "height": {"magnitude": inches_to_emu(desc_height), "unit": "EMU"},
                            },
                            "transform": {
                                "scaleX": 1, "scaleY": 1, "shearX": 0, "shearY": 0,
                                "translateX": inches_to_emu(x + padding),
                                "translateY": inches_to_emu(desc_y),
                                "unit": "EMU",
                            },
                        },
                    },
                },
                {
                    "insertText": {
                        "objectId": desc_id,
                        "text": _unescape_text(description),
                        "insertionIndex": 0,
                    },
                },
                {
                    "updateTextStyle": {
                        "objectId": desc_id,
                        "style": {
                            "fontFamily": "Arial",
                            "fontSize": {"magnitude": 11, "unit": "PT"},
                            "italic": True,
                            "foregroundColor": {"opaqueColor": {"rgbColor": hex_to_rgb("#999999")}},
                        },
                        "fields": "fontFamily,fontSize,italic,foregroundColor",
                        "textRange": {"type": "ALL"},
                    },
                },
                {
                    "updateParagraphStyle": {
                        "objectId": desc_id,
                        "style": {"alignment": "CENTER"},
                        "fields": "alignment",
                        "textRange": {"type": "ALL"},
                    },
                },
            ])

        await service.batch_update(presentation_id, requests)

        return {"element_ids": element_ids}
