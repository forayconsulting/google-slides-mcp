"""Utility tools for inspecting and managing presentations.

Tools for listing slides, getting element information, and
exporting thumbnails.
"""

from typing import TYPE_CHECKING, Literal

from fastmcp import Context

if TYPE_CHECKING:
    from fastmcp import FastMCP


def _extract_table_cells(table: dict) -> list[list[str]]:
    """Extract cell text from a table element as a 2D array.

    Args:
        table: The table object from a page element

    Returns:
        2D list of cell text strings, rows x columns
    """
    cells: list[list[str]] = []
    for row in table.get("tableRows", []):
        row_cells: list[str] = []
        for cell in row.get("tableCells", []):
            text_content = ""
            for text_elem in cell.get("text", {}).get("textElements", []):
                text_run = text_elem.get("textRun")
                if text_run:
                    text_content += text_run.get("content", "")
            row_cells.append(text_content.strip())
        cells.append(row_cells)
    return cells


def _parse_slide_elements(
    slide: dict,
    include_table_data: bool = False,
) -> tuple[list[dict], list[dict]]:
    """Parse all elements on a slide into structured dicts with warnings.

    Shared helper used by inspect_slide and inspect_slides.

    Args:
        slide: The slide/page data from the API (must have pageElements)
        include_table_data: When True, TABLE elements include a cells 2D array

    Returns:
        Tuple of (elements list, warnings list)
    """
    from google_slides_mcp.utils.transforms import extract_element_bounds
    from google_slides_mcp.utils.units import emu_to_inches

    elements: list[dict] = []
    warnings: list[dict] = []

    for page_element in slide.get("pageElements", []):
        element_id = page_element.get("objectId", "")
        entry: dict = {"id": element_id}

        # Extract position and size
        if page_element.get("size") and page_element.get("transform"):
            x, y, width, height = extract_element_bounds(page_element)
            entry["position"] = {
                "x": round(emu_to_inches(x), 2),
                "y": round(emu_to_inches(y), 2),
            }
            entry["size"] = {
                "width": round(emu_to_inches(width), 2),
                "height": round(emu_to_inches(height), 2),
            }

        if "shape" in page_element:
            shape = page_element["shape"]
            entry["type"] = "SHAPE"
            entry["shape_type"] = shape.get("shapeType", "UNKNOWN")

            # Placeholder
            placeholder = shape.get("placeholder", {})
            if placeholder.get("type"):
                entry["placeholder_type"] = placeholder["type"]

            # Text content and formatting
            text_elements = shape.get("text", {}).get("textElements", [])
            text_content = ""
            first_run_style = None

            for text_elem in text_elements:
                text_run = text_elem.get("textRun")
                if text_run:
                    text_content += text_run.get("content", "")
                    if first_run_style is None:
                        first_run_style = text_run.get("style", {})

            trimmed_text = text_content.strip()
            if trimmed_text:
                entry["text"] = trimmed_text

            # Extract formatting from first text run
            if first_run_style:
                formatting: dict = {}
                if first_run_style.get("fontFamily"):
                    formatting["font_family"] = first_run_style["fontFamily"]
                font_size = first_run_style.get("fontSize", {})
                if font_size.get("magnitude"):
                    formatting["font_size_pt"] = font_size["magnitude"]
                if first_run_style.get("bold"):
                    formatting["bold"] = True
                if first_run_style.get("italic"):
                    formatting["italic"] = True

                fg_color = first_run_style.get("foregroundColor", {})
                rgb = fg_color.get("opaqueColor", {}).get("rgbColor", {})
                if rgb:
                    r = round(rgb.get("red", 0) * 255)
                    g = round(rgb.get("green", 0) * 255)
                    b = round(rgb.get("blue", 0) * 255)
                    formatting["color"] = f"#{r:02x}{g:02x}{b:02x}"

                if formatting:
                    entry["formatting"] = formatting

            # Overflow heuristic
            size_obj = entry.get("size")
            if size_obj and trimmed_text:
                font_size_pt = (
                    first_run_style.get("fontSize", {}).get("magnitude", 12)
                    if first_run_style
                    else 12
                )
                char_width_inches = font_size_pt * 0.5 / 72
                chars_per_line = max(1, int(size_obj["width"] / char_width_inches))
                text_lines = trimmed_text.count("\n") + 1
                estimated_lines = max(
                    text_lines, -(-len(trimmed_text) // chars_per_line)
                )
                text_height_inches = estimated_lines * font_size_pt * 1.3 / 72

                if text_height_inches > size_obj["height"] * 1.1:
                    warnings.append(
                        {
                            "element_id": element_id,
                            "type": "possible_overflow",
                            "message": (
                                f"Text (~{len(trimmed_text)} chars) may overflow "
                                f"shape ({size_obj['width']}\" x {size_obj['height']}\") "
                                f"at {font_size_pt}pt"
                            ),
                        }
                    )

            # Empty placeholder warning
            if placeholder.get("type") and not trimmed_text:
                warnings.append(
                    {
                        "element_id": element_id,
                        "type": "empty_text",
                        "message": (
                            f"{placeholder['type']} placeholder has no content "
                            "— may be a leftover placeholder"
                        ),
                    }
                )

        elif "image" in page_element:
            entry["type"] = "IMAGE"
            entry["source_url"] = page_element["image"].get("sourceUrl", "")

        elif "table" in page_element:
            entry["type"] = "TABLE"
            table = page_element["table"]
            entry["rows"] = table.get("rows", 0)
            entry["columns"] = table.get("columns", 0)

            # Calculate actual table width from column widths
            table_columns = table.get("tableColumns", [])
            if table_columns:
                total_width = sum(
                    col.get("columnWidth", {}).get("magnitude", 0)
                    for col in table_columns
                )
                if total_width > 0:
                    current_size = entry.get("size")
                    entry["size"] = {
                        "width": round(emu_to_inches(total_width), 2),
                        "height": current_size["height"] if current_size else None,
                    }

            if include_table_data:
                entry["cells"] = _extract_table_cells(table)

        elif "line" in page_element:
            entry["type"] = "LINE"
            entry["line_type"] = page_element["line"].get("lineType", "UNKNOWN")

        elif "video" in page_element:
            entry["type"] = "VIDEO"

        else:
            entry["type"] = "UNKNOWN"

        elements.append(entry)

    return elements, warnings


def register_utility_tools(mcp: "FastMCP") -> None:
    """Register utility tools with the MCP application.

    Args:
        mcp: The FastMCP application instance
    """

    @mcp.tool()
    async def list_slides(
        ctx: Context,
        presentation_id: str,
    ) -> list[dict]:
        """List all slides with their IDs, titles, and element counts.

        Args:
            presentation_id: The presentation to list slides from

        Returns:
            List of slide info dictionaries with:
            - slide_id: The slide's object ID
            - index: Position in the presentation (0-based)
            - title: Title text (extracted from title placeholder)
            - element_count: Number of elements on the slide
        """
        from google_slides_mcp.auth.middleware import GoogleAuthMiddleware
        from google_slides_mcp.services.slides_service import SlidesService

        middleware = GoogleAuthMiddleware()
        credentials = await middleware.extract_credentials(ctx)
        service = SlidesService(credentials)

        presentation = await service.get_presentation(presentation_id)

        slides_info = []
        for i, slide in enumerate(presentation.get("slides", [])):
            slide_id = slide.get("objectId", "")
            element_count = len(slide.get("pageElements", []))

            # Try to extract title from title placeholder
            title = ""
            for element in slide.get("pageElements", []):
                shape = element.get("shape", {})
                placeholder = shape.get("placeholder", {})
                if placeholder.get("type") == "TITLE":
                    text_elements = shape.get("text", {}).get("textElements", [])
                    for text_elem in text_elements:
                        text_run = text_elem.get("textRun", {})
                        content = text_run.get("content", "")
                        if content.strip():
                            title = content.strip()
                            break
                    break

            slides_info.append(
                {
                    "slide_id": slide_id,
                    "index": i,
                    "title": title,
                    "element_count": element_count,
                }
            )

        return slides_info

    @mcp.tool()
    async def get_element_info(
        ctx: Context,
        presentation_id: str,
        element_id: str,
    ) -> dict:
        """Get detailed information about a page element.

        Returns position, size, and properties in human-readable format
        using inches instead of EMUs.

        Args:
            presentation_id: The presentation containing the element
            element_id: The element to get info about

        Returns:
            Dictionary with:
            - id: Element ID
            - type: Element type (SHAPE, IMAGE, TABLE, etc.)
            - position: {x_inches, y_inches}
            - size: {width_inches, height_inches}
            - text: Text content (if applicable)
            - shape_type: Shape type (if applicable)
            - image_url: Source URL (if applicable)
        """
        from google_slides_mcp.auth.middleware import GoogleAuthMiddleware
        from google_slides_mcp.services.slides_service import SlidesService
        from google_slides_mcp.utils.transforms import extract_element_bounds
        from google_slides_mcp.utils.units import emu_to_inches

        middleware = GoogleAuthMiddleware()
        credentials = await middleware.extract_credentials(ctx)
        service = SlidesService(credentials)

        presentation = await service.get_presentation(presentation_id)

        # Find the element
        element = None
        for slide in presentation.get("slides", []):
            for page_element in slide.get("pageElements", []):
                if page_element.get("objectId") == element_id:
                    element = page_element
                    break
            if element:
                break

        if not element:
            raise ValueError(f"Element {element_id} not found")

        # Extract basic info
        x, y, width, height = extract_element_bounds(element)

        info: dict = {
            "id": element_id,
            "position": {"x_inches": emu_to_inches(x), "y_inches": emu_to_inches(y)},
            "size": {
                "width_inches": emu_to_inches(width),
                "height_inches": emu_to_inches(height),
            },
        }

        # Determine type and type-specific info
        if "shape" in element:
            shape = element["shape"]
            info["type"] = "SHAPE"
            info["shape_type"] = shape.get("shapeType", "UNKNOWN")

            # Extract text if present
            text_content = ""
            text_elements = shape.get("text", {}).get("textElements", [])
            for text_elem in text_elements:
                text_run = text_elem.get("textRun", {})
                content = text_run.get("content", "")
                text_content += content

            if text_content.strip():
                info["text"] = text_content.strip()

            # Check for placeholder
            placeholder = shape.get("placeholder", {})
            if placeholder:
                info["placeholder_type"] = placeholder.get("type")

        elif "image" in element:
            info["type"] = "IMAGE"
            image = element["image"]
            info["image_url"] = image.get("sourceUrl", "")
            info["content_url"] = image.get("contentUrl", "")

        elif "table" in element:
            info["type"] = "TABLE"
            table = element["table"]
            info["rows"] = table.get("rows", 0)
            info["columns"] = table.get("columns", 0)

        elif "line" in element:
            info["type"] = "LINE"
            line = element["line"]
            info["line_type"] = line.get("lineType", "UNKNOWN")

        elif "video" in element:
            info["type"] = "VIDEO"
            video = element["video"]
            info["video_source"] = video.get("source", "UNKNOWN")
            info["video_url"] = video.get("url", "")

        elif "sheetsChart" in element:
            info["type"] = "SHEETS_CHART"
            chart = element["sheetsChart"]
            info["spreadsheet_id"] = chart.get("spreadsheetId", "")
            info["chart_id"] = chart.get("chartId", "")

        else:
            info["type"] = "UNKNOWN"

        return info

    @mcp.tool()
    async def inspect_slide(
        ctx: Context,
        presentation_id: str,
        slide_id: str,
        include_table_data: bool = False,
    ) -> dict:
        """Inspect all elements on a slide with positions, sizes, text, and formatting.

        Returns warnings for potential issues (text overflow, empty placeholders).

        IMPORTANT: ALWAYS run this after creating or modifying a slide.
        Do not skip this step.
        - BEFORE: Understand the slide's visual structure and formatting
        - AFTER: Verify changes look correct and no warnings are present

        If warnings indicate text overflow, consider: shorter text, smaller font, or larger shape.

        For inspecting 3+ slides at once, use inspect_slides (plural) instead -- it fetches
        all slide data in a single call.

        Args:
            presentation_id: The presentation ID
            slide_id: The slide to inspect
            include_table_data: When true, TABLE elements include a cells 2D array
                with the text content of each cell

        Returns:
            Dictionary with:
            - slide_id: The slide's object ID
            - element_count: Number of elements on the slide
            - elements: List of element details (type, position, size, text, formatting)
            - warnings: List of potential issues (overflow, empty placeholders)
        """
        from google_slides_mcp.auth.middleware import GoogleAuthMiddleware
        from google_slides_mcp.services.slides_service import SlidesService

        middleware = GoogleAuthMiddleware()
        credentials = await middleware.extract_credentials(ctx)
        service = SlidesService(credentials)

        slide = await service.get_page(presentation_id, slide_id)

        elements, warnings = _parse_slide_elements(slide, include_table_data)

        result: dict = {
            "slide_id": slide_id,
            "element_count": len(elements),
            "elements": elements,
        }
        if warnings:
            result["warnings"] = warnings

        return result

    @mcp.tool()
    async def inspect_slides(
        ctx: Context,
        presentation_id: str,
        slide_ids: list[str] | None = None,
        include_table_data: bool = False,
    ) -> dict:
        """Inspect multiple slides in one call. More efficient than
        calling inspect_slide repeatedly.

        Fetches the presentation once and parses all requested slides.
        If slide_ids is omitted, inspects ALL slides.

        Args:
            presentation_id: The presentation ID
            slide_ids: Optional list of slide IDs to inspect. If omitted, inspects all slides.
            include_table_data: When true, TABLE elements include a cells 2D array
                with the text content of each cell

        Returns:
            Dictionary with:
            - slides: List of per-slide results (slide_id, elements, warnings)
            - total_slides: Number of slides inspected
            - total_warnings: Total warnings across all slides
        """
        from google_slides_mcp.auth.middleware import GoogleAuthMiddleware
        from google_slides_mcp.services.slides_service import SlidesService

        middleware = GoogleAuthMiddleware()
        credentials = await middleware.extract_credentials(ctx)
        service = SlidesService(credentials)

        presentation = await service.get_presentation(
            presentation_id,
            fields="slides(objectId,pageElements)",
        )

        slides_result: list[dict] = []
        total_warnings = 0

        for slide in presentation.get("slides", []):
            sid = slide.get("objectId", "")
            if slide_ids is not None and sid not in slide_ids:
                continue

            elements, warnings = _parse_slide_elements(slide, include_table_data)
            total_warnings += len(warnings)

            slide_entry: dict = {
                "slide_id": sid,
                "element_count": len(elements),
                "elements": elements,
            }
            if warnings:
                slide_entry["warnings"] = warnings
            slides_result.append(slide_entry)

        return {
            "slides": slides_result,
            "total_slides": len(slides_result),
            "total_warnings": total_warnings,
        }

    @mcp.tool()
    async def list_layouts(
        ctx: Context,
        presentation_id: str,
    ) -> list[dict]:
        """List all available slide layouts with IDs, names,
        and placeholder types.

        Useful for PPTX-converted presentations where predefined layout names may not work.

        Args:
            presentation_id: The presentation to list layouts from

        Returns:
            List of layout info dictionaries with:
            - layout_id: The layout's object ID
            - name: Internal layout name
            - display_name: Human-readable display name
            - placeholder_types: List of placeholder types in the layout
        """
        from google_slides_mcp.auth.middleware import GoogleAuthMiddleware
        from google_slides_mcp.services.slides_service import SlidesService

        middleware = GoogleAuthMiddleware()
        credentials = await middleware.extract_credentials(ctx)
        service = SlidesService(credentials)

        presentation = await service.get_presentation(
            presentation_id,
            fields="layouts(objectId,layoutProperties,pageElements.shape.placeholder)",
        )

        layouts_info = []
        for layout in presentation.get("layouts", []):
            layout_id = layout.get("objectId", "")
            props = layout.get("layoutProperties", {})
            name = props.get("name", "")
            display_name = props.get("displayName", "")

            placeholder_types = []
            for element in layout.get("pageElements", []):
                p_type = element.get("shape", {}).get("placeholder", {}).get("type")
                if p_type:
                    placeholder_types.append(p_type)

            layouts_info.append({
                "layout_id": layout_id,
                "name": name,
                "display_name": display_name,
                "placeholder_types": placeholder_types,
            })

        return layouts_info

    @mcp.tool()
    async def export_thumbnail(
        ctx: Context,
        presentation_id: str,
        slide_id: str,
        mime_type: Literal["PNG", "JPEG"] = "PNG",
    ) -> dict:
        """Generate a thumbnail image of a slide.

        Args:
            presentation_id: The presentation ID
            slide_id: The slide to generate a thumbnail for
            mime_type: Image format (PNG or JPEG)

        Returns:
            Dictionary with:
            - content_url: Temporary URL to the thumbnail image
            - width: Image width in pixels
            - height: Image height in pixels
        """
        from google_slides_mcp.auth.middleware import GoogleAuthMiddleware
        from google_slides_mcp.services.slides_service import SlidesService

        middleware = GoogleAuthMiddleware()
        credentials = await middleware.extract_credentials(ctx)
        service = SlidesService(credentials)

        # Get the thumbnail using the pages.getThumbnail method
        # Note: This requires building a custom request since it's not
        # part of the standard presentations resource
        from googleapiclient.discovery import build

        slides_service = build("slides", "v1", credentials=credentials)

        thumbnail = (
            slides_service.presentations()
            .pages()
            .getThumbnail(
                presentationId=presentation_id,
                pageObjectId=slide_id,
                thumbnailProperties_mimeType=mime_type,
            )
            .execute()
        )

        return {
            "content_url": thumbnail.get("contentUrl", ""),
            "width": thumbnail.get("width", 0),
            "height": thumbnail.get("height", 0),
        }
