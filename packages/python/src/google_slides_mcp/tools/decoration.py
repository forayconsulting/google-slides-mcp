"""Decoration tools for Google Slides.

Tools for slide backgrounds, lines, and other decorative elements.
"""

from typing import TYPE_CHECKING, Literal
import uuid

from fastmcp import Context

if TYPE_CHECKING:
    from fastmcp import FastMCP


def register_decoration_tools(mcp: "FastMCP") -> None:
    """Register decoration tools with the MCP application."""

    @mcp.tool()
    async def set_slide_background(
        ctx: Context,
        presentation_id: str,
        slide_id: str,
        color: str | None = None,
        image_url: str | None = None,
    ) -> dict:
        """Set a slide's background to a solid color or a stretched image.

        Args:
            presentation_id: The presentation ID
            slide_id: The slide to update
            color: Background color hex (e.g., '#1a73e8'). Mutually exclusive with image_url
            image_url: Background image URL (stretched to fill). Mutually exclusive with color

        Returns:
            Dictionary with slide_id and background type
        """
        from google_slides_mcp.auth.middleware import GoogleAuthMiddleware
        from google_slides_mcp.services.slides_service import SlidesService
        from google_slides_mcp.utils.colors import hex_to_rgb

        if not color and not image_url:
            raise ValueError("Must provide either color or image_url")
        if color and image_url:
            raise ValueError("Provide either color or image_url, not both")

        middleware = GoogleAuthMiddleware()
        credentials = await middleware.extract_credentials(ctx)
        service = SlidesService(credentials)

        if color:
            page_background_fill = {
                "solidFill": {
                    "color": {"rgbColor": hex_to_rgb(color)},
                },
            }
            fields = "pageBackgroundFill.solidFill.color"
        else:
            page_background_fill = {
                "stretchedPictureFill": {
                    "contentUrl": image_url,
                },
            }
            fields = "pageBackgroundFill.stretchedPictureFill.contentUrl"

        await service.batch_update(presentation_id, [
            {
                "updatePageProperties": {
                    "objectId": slide_id,
                    "pageProperties": {"pageBackgroundFill": page_background_fill},
                    "fields": fields,
                },
            },
        ])

        return {
            "slide_id": slide_id,
            "background": "solid_color" if color else "image",
        }

    @mcp.tool()
    async def add_line(
        ctx: Context,
        presentation_id: str,
        slide_id: str,
        start_x: float,
        start_y: float,
        end_x: float,
        end_y: float,
        color: str = "#DADCE0",
        weight: float = 1.0,
        dash_style: Literal[
            "SOLID", "DOT", "DASH", "DASH_DOT", "LONG_DASH", "LONG_DASH_DOT"
        ] = "SOLID",
    ) -> dict:
        """Add a straight line to a slide. Use for dividers, connectors, and decorative elements.

        Args:
            presentation_id: The presentation ID
            slide_id: The slide to add the line to
            start_x: Start X position in inches
            start_y: Start Y position in inches
            end_x: End X position in inches
            end_y: End Y position in inches
            color: Line color hex
            weight: Line weight in points
            dash_style: Line dash style

        Returns:
            Dictionary with the created element ID
        """
        from google_slides_mcp.auth.middleware import GoogleAuthMiddleware
        from google_slides_mcp.services.slides_service import SlidesService
        from google_slides_mcp.utils.colors import hex_to_rgb
        from google_slides_mcp.utils.units import inches_to_emu

        middleware = GoogleAuthMiddleware()
        credentials = await middleware.extract_credentials(ctx)
        service = SlidesService(credentials)

        element_id = f"line_{uuid.uuid4().hex[:8]}"

        delta_x = end_x - start_x
        delta_y = end_y - start_y

        width_inches = abs(delta_x)
        height_inches = abs(delta_y)

        scale_x = 1 if delta_x >= 0 else -1
        scale_y = 1 if delta_y >= 0 else -1

        translate_x = min(start_x, end_x)
        translate_y = min(start_y, end_y)

        size_width = max(width_inches, 0.001)
        size_height = max(height_inches, 0.001)

        requests = [
            {
                "createLine": {
                    "objectId": element_id,
                    "lineCategory": "STRAIGHT",
                    "elementProperties": {
                        "pageObjectId": slide_id,
                        "size": {
                            "width": {"magnitude": inches_to_emu(size_width), "unit": "EMU"},
                            "height": {"magnitude": inches_to_emu(size_height), "unit": "EMU"},
                        },
                        "transform": {
                            "scaleX": scale_x,
                            "scaleY": scale_y,
                            "shearX": 0,
                            "shearY": 0,
                            "translateX": inches_to_emu(translate_x),
                            "translateY": inches_to_emu(translate_y),
                            "unit": "EMU",
                        },
                    },
                },
            },
            {
                "updateLineProperties": {
                    "objectId": element_id,
                    "lineProperties": {
                        "lineFill": {
                            "solidFill": {
                                "color": {"rgbColor": hex_to_rgb(color)},
                            },
                        },
                        "weight": {"magnitude": weight, "unit": "PT"},
                        "dashStyle": dash_style,
                    },
                    "fields": "lineFill.solidFill.color,weight,dashStyle",
                },
            },
        ]

        await service.batch_update(presentation_id, requests)

        return {"element_id": element_id}
