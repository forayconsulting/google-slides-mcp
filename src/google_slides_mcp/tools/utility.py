"""Utility tools for inspecting and managing presentations.

Tools for listing slides, getting element information, and
exporting thumbnails.
"""

from typing import TYPE_CHECKING, Literal

if TYPE_CHECKING:
    from fastmcp import Context, FastMCP


def register_utility_tools(mcp: "FastMCP") -> None:
    """Register utility tools with the MCP application.

    Args:
        mcp: The FastMCP application instance
    """

    @mcp.tool()
    async def list_slides(
        presentation_id: str,
        ctx: "Context",
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
        presentation_id: str,
        element_id: str,
        ctx: "Context",
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
    async def export_thumbnail(
        presentation_id: str,
        slide_id: str,
        mime_type: Literal["PNG", "JPEG"] = "PNG",
        ctx: "Context",
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
                thumbnailProperties_mimeType=f"image/{mime_type.lower()}",
            )
            .execute()
        )

        return {
            "content_url": thumbnail.get("contentUrl", ""),
            "width": thumbnail.get("width", 0),
            "height": thumbnail.get("height", 0),
        }
