"""Content update tools for semantic text and styling operations.

Tools for updating slide content by placeholder type and applying
consistent styling across presentations.
"""

from typing import TYPE_CHECKING

from fastmcp import Context

if TYPE_CHECKING:
    from fastmcp import FastMCP


def _find_placeholder_elements(slide: dict, placeholder_type: str) -> list[dict]:
    """Find all elements matching a placeholder type on a slide.

    Args:
        slide: The slide data from the API
        placeholder_type: The placeholder type to find (TITLE, SUBTITLE, BODY, etc.)

    Returns:
        List of dicts with object_id, placeholder_type, and current_text
    """
    results = []
    for element in slide.get("pageElements", []):
        shape = element.get("shape", {})
        placeholder = shape.get("placeholder", {})
        if placeholder.get("type") == placeholder_type:
            # Extract current text
            text_elements = shape.get("text", {}).get("textElements", [])
            current_text = "".join(
                te.get("textRun", {}).get("content", "") for te in text_elements
            )
            results.append(
                {
                    "object_id": element.get("objectId"),
                    "placeholder_type": placeholder_type,
                    "current_text": current_text.strip(),
                }
            )
    return results


def _find_all_placeholders(slide: dict) -> list[dict]:
    """Find all placeholder elements on a slide.

    Args:
        slide: The slide data from the API

    Returns:
        List of dicts with object_id, placeholder_type, and current_text
    """
    results = []
    for element in slide.get("pageElements", []):
        shape = element.get("shape", {})
        placeholder = shape.get("placeholder", {})
        placeholder_type = placeholder.get("type")
        if placeholder_type:
            text_elements = shape.get("text", {}).get("textElements", [])
            current_text = "".join(
                te.get("textRun", {}).get("content", "") for te in text_elements
            )
            results.append(
                {
                    "object_id": element.get("objectId"),
                    "placeholder_type": placeholder_type,
                    "current_text": current_text.strip(),
                }
            )
    return results


def _unescape_text(text: str) -> str:
    """Unescape literal \\n and \\t sequences that LLMs sometimes double-escape."""
    return text.replace("\\n", "\n").replace("\\t", "\t")


def _build_text_replacement_requests(
    object_id: str,
    new_text: str,
    current_text: str,
    add_bullets: bool = False,
) -> list[dict]:
    """Build text replacement requests, conditionally skipping deleteText for empty
    placeholders and optionally adding bullet formatting.

    Args:
        object_id: The element's object ID
        new_text: The new text to insert
        current_text: The current text in the placeholder (trimmed)
        add_bullets: Whether to add bullet formatting after inserting text

    Returns:
        List of request dicts
    """
    requests: list[dict] = []
    if len(current_text) > 0:
        requests.append(
            {"deleteText": {"objectId": object_id, "textRange": {"type": "ALL"}}}
        )
    requests.append(
        {"insertText": {"objectId": object_id, "text": _unescape_text(new_text), "insertionIndex": 0}}
    )
    if add_bullets:
        requests.append(
            {
                "createParagraphBullets": {
                    "objectId": object_id,
                    "textRange": {"type": "ALL"},
                    "bulletPreset": "BULLET_DISC_CIRCLE_SQUARE",
                }
            }
        )
    return requests


def _build_style_request(
    object_id: str,
    font_size_pt: int | None = None,
    bold: bool | None = None,
    italic: bool | None = None,
    font_family: str | None = None,
    color: str | None = None,
) -> dict | None:
    """Build updateTextStyle request with only specified fields.

    Args:
        object_id: The element's object ID
        font_size_pt: Font size in points
        bold: Whether text should be bold
        italic: Whether text should be italic
        font_family: Font family name
        color: Hex color string like "#FF0000"

    Returns:
        updateTextStyle request dict, or None if no style properties specified
    """
    style: dict = {}
    fields: list[str] = []

    if font_size_pt is not None:
        style["fontSize"] = {"magnitude": font_size_pt, "unit": "PT"}
        fields.append("fontSize")
    if bold is not None:
        style["bold"] = bold
        fields.append("bold")
    if italic is not None:
        style["italic"] = italic
        fields.append("italic")
    if font_family is not None:
        style["fontFamily"] = font_family
        fields.append("fontFamily")
    if color is not None:
        from google_slides_mcp.utils.colors import hex_to_rgb

        style["foregroundColor"] = {"opaqueColor": {"rgbColor": hex_to_rgb(color)}}
        fields.append("foregroundColor")

    if not fields:
        return None

    return {
        "updateTextStyle": {
            "objectId": object_id,
            "style": style,
            "fields": ",".join(fields),
            "textRange": {"type": "ALL"},
        }
    }


def _to_api_alignment(alignment: str) -> str:
    """Map user-facing alignment values to Google Slides API ParagraphStyle.Alignment enum."""
    if alignment == "LEFT":
        return "START"
    if alignment == "RIGHT":
        return "END"
    return alignment


def _build_paragraph_style_request(
    object_id: str,
    alignment: str | None = None,
) -> dict | None:
    """Build updateParagraphStyle request.

    Args:
        object_id: The element's object ID
        alignment: Text alignment (LEFT, CENTER, RIGHT)

    Returns:
        updateParagraphStyle request dict, or None if no properties specified
    """
    if alignment is None:
        return None

    return {
        "updateParagraphStyle": {
            "objectId": object_id,
            "style": {"alignment": _to_api_alignment(alignment)},
            "fields": "alignment",
            "textRange": {"type": "ALL"},
        }
    }


def register_content_tools(mcp: "FastMCP") -> None:
    """Register content update tools with the MCP application.

    Args:
        mcp: The FastMCP application instance
    """

    @mcp.tool()
    async def update_slide_content(
        ctx: Context,
        presentation_id: str,
        slide_id: str,
        content: dict,
    ) -> dict:
        """Update slide text by placeholder type (TITLE, SUBTITLE, BODY).

        No element IDs needed - automatically finds placeholders and replaces text.
        BODY can be a string or list (joined with newlines).

        NOTE: For multiple slides, PREFER update_presentation_content
        (single API call, more efficient).

        IMPORTANT: Before using this tool, use inspect_slide to understand the slide's
        visual structure and existing formatting. If the source material does not
        explicitly specify content for a placeholder, ask the user rather than guessing.

        Args:
            presentation_id: The presentation ID
            slide_id: The slide to update
            content: Dict mapping placeholder types to new text
                Example: {"TITLE": "Hello", "BODY": ["Point 1", "Point 2"]}

        Returns:
            Dictionary with:
            - updated: Dict of placeholder types that were updated
            - not_found: List of placeholder types that weren't found on the slide
        """
        from google_slides_mcp.auth.middleware import GoogleAuthMiddleware
        from google_slides_mcp.services.slides_service import SlidesService

        middleware = GoogleAuthMiddleware()
        credentials = await middleware.extract_credentials(ctx)
        service = SlidesService(credentials)

        # Get the specific slide
        slide = await service.get_page(presentation_id, slide_id)

        requests: list[dict] = []
        updated: dict[str, bool] = {}
        not_found: list[str] = []

        for placeholder_type, new_text_input in content.items():
            is_array = isinstance(new_text_input, list)
            # Handle list content (join with newlines)
            if is_array:
                new_text = "\n".join(str(item) for item in new_text_input)
            else:
                new_text = str(new_text_input)
            add_bullets = is_array and placeholder_type == "BODY"

            # Find matching placeholders
            elements = _find_placeholder_elements(slide, placeholder_type)

            if elements:
                for element in elements:
                    requests.extend(
                        _build_text_replacement_requests(
                            element["object_id"],
                            new_text,
                            element["current_text"],
                            add_bullets,
                        )
                    )
                updated[placeholder_type] = True
            else:
                not_found.append(placeholder_type)

        # Execute all requests in one batch
        if requests:
            await service.batch_update(presentation_id, requests)

        return {"updated": updated, "not_found": not_found}

    @mcp.tool()
    async def update_presentation_content(
        ctx: Context,
        presentation_id: str,
        slides: list,
    ) -> dict:
        """Update text across multiple slides in one call.

        Each item maps slide_id to placeholder content. More efficient than
        calling update_slide_content multiple times.

        IMPORTANT: Before bulk-updating slides, use inspect_slide on at least one
        representative slide to understand the template's visual structure. Do not
        fabricate names, roles, dates, or data — ask the user for any information
        not explicitly provided in the source material.

        Args:
            presentation_id: The presentation ID
            slides: List of dicts with slide_id and placeholder content
                Example: [
                    {"slide_id": "p3", "TITLE": "Slide 1", "BODY": "Content"},
                    {"slide_id": "p4", "TITLE": "Slide 2"}
                ]

        Returns:
            Dictionary with:
            - slides_updated: Number of slides that had content updated
            - placeholders_updated: Total number of placeholders updated
            - errors: List of any errors encountered
        """
        from google_slides_mcp.auth.middleware import GoogleAuthMiddleware
        from google_slides_mcp.services.slides_service import SlidesService

        middleware = GoogleAuthMiddleware()
        credentials = await middleware.extract_credentials(ctx)
        service = SlidesService(credentials)

        # Get full presentation to access all slides
        presentation = await service.get_presentation(presentation_id)

        # Build a map of slide_id to slide data
        slide_map: dict[str, dict] = {}
        for slide in presentation.get("slides", []):
            slide_map[slide.get("objectId", "")] = slide

        requests: list[dict] = []
        slides_updated = 0
        placeholders_updated = 0
        errors: list[str] = []

        for slide_spec in slides:
            slide_id = slide_spec.get("slide_id")
            if not slide_id:
                errors.append("Missing slide_id in slide specification")
                continue

            slide = slide_map.get(slide_id)
            if not slide:
                errors.append(f"Slide {slide_id} not found in presentation")
                continue

            slide_had_updates = False

            for key, new_text_input in slide_spec.items():
                if key == "slide_id":
                    continue

                is_array = isinstance(new_text_input, list)
                # Handle list content
                if is_array:
                    new_text = "\n".join(str(item) for item in new_text_input)
                else:
                    new_text = str(new_text_input)
                add_bullets = is_array and key == "BODY"

                # Find matching placeholders
                elements = _find_placeholder_elements(slide, key)

                for element in elements:
                    requests.extend(
                        _build_text_replacement_requests(
                            element["object_id"],
                            new_text,
                            element["current_text"],
                            add_bullets,
                        )
                    )
                    placeholders_updated += 1
                    slide_had_updates = True

            if slide_had_updates:
                slides_updated += 1

        # Execute all requests in one batch
        if requests:
            await service.batch_update(presentation_id, requests)

        return {
            "slides_updated": slides_updated,
            "placeholders_updated": placeholders_updated,
            "errors": errors,
        }

    @mcp.tool()
    async def apply_text_style(
        ctx: Context,
        presentation_id: str,
        placeholder_type: str,
        slide_ids: list | None = None,
        font_size_pt: int | None = None,
        bold: bool | None = None,
        italic: bool | None = None,
        font_family: str | None = None,
        color: str | None = None,
        alignment: str | None = None,
    ) -> dict:
        """Apply consistent styling to placeholder types across slides.

        Only specified style properties are changed; others are preserved.
        Use this after update_presentation_content to apply consistent styling.

        Args:
            presentation_id: The presentation ID
            placeholder_type: The placeholder type to style (TITLE, SUBTITLE, BODY)
            slide_ids: List of slide IDs to style, or None for all slides
            font_size_pt: Font size in points
            bold: Whether text should be bold
            italic: Whether text should be italic
            font_family: Font family name (e.g., "Arial", "Roboto")
            color: Hex color string (e.g., "#FF0000" for red)
            alignment: Text alignment (LEFT, CENTER, RIGHT)

        Returns:
            Dictionary with:
            - elements_styled: Number of elements that had styling applied
            - slides_affected: List of slide IDs that were modified
        """
        from google_slides_mcp.auth.middleware import GoogleAuthMiddleware
        from google_slides_mcp.services.slides_service import SlidesService

        middleware = GoogleAuthMiddleware()
        credentials = await middleware.extract_credentials(ctx)
        service = SlidesService(credentials)

        # Get full presentation
        presentation = await service.get_presentation(presentation_id)

        requests: list[dict] = []
        elements_styled = 0
        slides_affected: list[str] = []

        for slide in presentation.get("slides", []):
            slide_id = slide.get("objectId", "")

            # Skip if not in specified slides
            if slide_ids is not None and slide_id not in slide_ids:
                continue

            # Find matching placeholders
            elements = _find_placeholder_elements(slide, placeholder_type)

            if elements:
                slides_affected.append(slide_id)

                for element in elements:
                    object_id = element["object_id"]

                    # Build style request
                    style_req = _build_style_request(
                        object_id,
                        font_size_pt=font_size_pt,
                        bold=bold,
                        italic=italic,
                        font_family=font_family,
                        color=color,
                    )
                    if style_req:
                        requests.append(style_req)

                    # Build paragraph style request
                    para_req = _build_paragraph_style_request(object_id, alignment)
                    if para_req:
                        requests.append(para_req)

                    if style_req or para_req:
                        elements_styled += 1

        # Execute all requests in one batch
        if requests:
            await service.batch_update(presentation_id, requests)

        return {
            "elements_styled": elements_styled,
            "slides_affected": slides_affected,
        }

    @mcp.tool()
    async def update_table_content(
        ctx: Context,
        presentation_id: str,
        slide_id: str,
        table_id: str,
        data: list[list[str]],
        style_header: bool = True,
        font_size: int = 9,
        font_family: str = "Nunito Sans",
    ) -> dict:
        """Update table cell text in bulk. Provide a 2D data array
        (row-major) to replace cell contents. Optionally styles the
        header row with bold text and the presentation's primary
        theme color.

        Use inspect_slide with include_table_data=true to read
        existing table content before updating.

        Args:
            presentation_id: The presentation ID
            slide_id: The slide containing the table
            table_id: Element ID of the table to update
            data: 2D array of cell text (row-major). Must match
                table dimensions.
            style_header: Bold + themed color for first row
            font_size: Font size in points for body cells
            font_family: Font family for all cells

        Returns:
            Dictionary with table_id, rows_updated, columns_updated
        """
        from google_slides_mcp.auth.middleware import GoogleAuthMiddleware
        from google_slides_mcp.services.slides_service import SlidesService
        from google_slides_mcp.utils.colors import hex_to_rgb

        middleware = GoogleAuthMiddleware()
        credentials = await middleware.extract_credentials(ctx)
        service = SlidesService(credentials)

        # Fetch slide to read current table cell text
        slide = await service.get_page(presentation_id, slide_id)

        table_element = None
        for el in slide.get("pageElements", []):
            if el.get("objectId") == table_id:
                table_element = el
                break

        if not table_element or "table" not in table_element:
            raise ValueError(
                f"Element {table_id} is not a table or was not "
                f"found on slide {slide_id}"
            )

        table = table_element["table"]
        row_count = table.get("rows", 0)
        col_count = table.get("columns", 0)

        if len(data) != row_count:
            raise ValueError(
                f"Data has {len(data)} rows but table has "
                f"{row_count} rows"
            )
        for r, row_data in enumerate(data):
            if len(row_data) != col_count:
                raise ValueError(
                    f"Data row {r} has {len(row_data)} columns "
                    f"but table has {col_count} columns"
                )

        # Read current cell text to conditionally skip deleteText
        current_cell_text: list[list[str]] = []
        for row in table.get("tableRows", []):
            row_texts: list[str] = []
            for cell in row.get("tableCells", []):
                text_elements = cell.get("text", {}).get(
                    "textElements", []
                )
                cell_content = "".join(
                    te.get("textRun", {}).get("content", "")
                    for te in text_elements
                )
                row_texts.append(cell_content.strip())
            current_cell_text.append(row_texts)

        requests: list[dict] = []

        # Extract theme style for header coloring
        header_color: str | None = None
        if style_header:
            try:
                from google_slides_mcp.utils.style import (
                    STYLE_FIELDS,
                    extract_presentation_style,
                )

                pres = await service.get_presentation(
                    presentation_id, fields=STYLE_FIELDS
                )
                style = extract_presentation_style(pres)
                header_color = style["primary_color"]
            except Exception:
                header_color = "#054950"

        for row in range(row_count):
            for col in range(col_count):
                current_text = (
                    current_cell_text[row][col]
                    if row < len(current_cell_text)
                    and col < len(current_cell_text[row])
                    else ""
                )
                new_text = _unescape_text(data[row][col])

                # Only delete if cell has existing content
                if len(current_text) > 0:
                    requests.append({
                        "deleteText": {
                            "objectId": table_id,
                            "cellLocation": {
                                "rowIndex": row,
                                "columnIndex": col,
                            },
                            "textRange": {"type": "ALL"},
                        },
                    })

                if new_text:
                    requests.append({
                        "insertText": {
                            "objectId": table_id,
                            "cellLocation": {
                                "rowIndex": row,
                                "columnIndex": col,
                            },
                            "text": new_text,
                            "insertionIndex": 0,
                        },
                    })

                # Style cells — only if the cell will have text
                if new_text:
                    is_header = style_header and row == 0
                    text_style: dict = {
                        "fontFamily": font_family,
                        "fontSize": {
                            "magnitude": font_size + 1
                            if is_header
                            else font_size,
                            "unit": "PT",
                        },
                        "bold": is_header,
                    }
                    fields = ["fontFamily", "fontSize", "bold"]

                    if is_header and header_color:
                        text_style["foregroundColor"] = {
                            "opaqueColor": {
                                "rgbColor": hex_to_rgb("#FFFFFF"),
                            },
                        }
                        fields.append("foregroundColor")

                    requests.append({
                        "updateTextStyle": {
                            "objectId": table_id,
                            "cellLocation": {
                                "rowIndex": row,
                                "columnIndex": col,
                            },
                            "style": text_style,
                            "fields": ",".join(fields),
                            "textRange": {"type": "ALL"},
                        },
                    })

                # Header background
                is_header = style_header and row == 0
                if is_header and header_color:
                    requests.append({
                        "updateTableCellProperties": {
                            "objectId": table_id,
                            "tableRange": {
                                "location": {
                                    "rowIndex": row,
                                    "columnIndex": col,
                                },
                                "rowSpan": 1,
                                "columnSpan": 1,
                            },
                            "tableCellProperties": {
                                "tableCellBackgroundFill": {
                                    "solidFill": {
                                        "color": {
                                            "rgbColor": hex_to_rgb(
                                                header_color
                                            ),
                                        },
                                    },
                                },
                            },
                            "fields": "tableCellBackgroundFill",
                        },
                    })

        if requests:
            await service.batch_update(presentation_id, requests)

        return {
            "table_id": table_id,
            "rows_updated": row_count,
            "columns_updated": col_count,
        }

    @mcp.tool()
    async def replace_text_on_slide(
        ctx: Context,
        presentation_id: str,
        slide_id: str,
        replacements: dict[str, str],
    ) -> dict:
        """Find and replace text within a single slide. Unlike
        replace_placeholders (which is presentation-wide), this
        targets only one slide. Useful for slide-specific edits
        like updating a name, date, or label without affecting
        other slides.

        For each text element on the slide, all occurrences of
        each search string are replaced. Example: replacing "Q1"
        with "Q2" in a shape containing "Q1 Results" produces
        "Q2 Results".

        Args:
            presentation_id: The presentation ID
            slide_id: The slide to search
            replacements: Mapping of old text to new text

        Returns:
            Dictionary with:
            - replacements_made: dict of search term to count
            - elements_modified: list of modified element IDs
        """
        from google_slides_mcp.auth.middleware import GoogleAuthMiddleware
        from google_slides_mcp.services.slides_service import SlidesService

        middleware = GoogleAuthMiddleware()
        credentials = await middleware.extract_credentials(ctx)
        service = SlidesService(credentials)

        slide = await service.get_page(presentation_id, slide_id)
        requests: list[dict] = []
        replacement_counts: dict[str, int] = {
            k: 0 for k in replacements
        }
        elements_modified: list[str] = []

        for element in slide.get("pageElements", []):
            element_id = element.get("objectId", "")

            # Extract full text from shape
            full_text = ""
            shape = element.get("shape", {})
            for te in shape.get("text", {}).get(
                "textElements", []
            ):
                text_run = te.get("textRun")
                if text_run:
                    full_text += text_run.get("content", "")

            if not full_text:
                continue

            # Apply all replacements to the full text
            modified_text = full_text
            element_was_modified = False

            for search, replace in replacements.items():
                if search in modified_text:
                    count = modified_text.count(search)
                    replacement_counts[search] += count
                    modified_text = modified_text.replace(
                        search, replace
                    )
                    element_was_modified = True

            if element_was_modified:
                if len(full_text) > 0:
                    requests.append({
                        "deleteText": {
                            "objectId": element_id,
                            "textRange": {"type": "ALL"},
                        },
                    })
                requests.append({
                    "insertText": {
                        "objectId": element_id,
                        "text": modified_text,
                        "insertionIndex": 0,
                    },
                })
                elements_modified.append(element_id)

        if requests:
            await service.batch_update(presentation_id, requests)

        return {
            "replacements_made": replacement_counts,
            "elements_modified": elements_modified,
        }
