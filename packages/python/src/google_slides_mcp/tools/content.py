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


def _build_text_replacement_requests(object_id: str, new_text: str) -> list[dict]:
    """Build deleteText + insertText pair for complete text replacement.

    Args:
        object_id: The element's object ID
        new_text: The new text to insert

    Returns:
        List of two request dicts (deleteText, insertText)
    """
    return [
        {"deleteText": {"objectId": object_id, "textRange": {"type": "ALL"}}},
        {"insertText": {"objectId": object_id, "text": new_text, "insertionIndex": 0}},
    ]


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
            "style": {"alignment": alignment},
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

        for placeholder_type, new_text in content.items():
            # Handle list content (join with newlines)
            if isinstance(new_text, list):
                new_text = "\n".join(str(item) for item in new_text)
            else:
                new_text = str(new_text)

            # Find matching placeholders
            elements = _find_placeholder_elements(slide, placeholder_type)

            if elements:
                for element in elements:
                    requests.extend(
                        _build_text_replacement_requests(element["object_id"], new_text)
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

            for key, new_text in slide_spec.items():
                if key == "slide_id":
                    continue

                # Handle list content
                if isinstance(new_text, list):
                    new_text = "\n".join(str(item) for item in new_text)
                else:
                    new_text = str(new_text)

                # Find matching placeholders
                elements = _find_placeholder_elements(slide, key)

                for element in elements:
                    requests.extend(
                        _build_text_replacement_requests(element["object_id"], new_text)
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
