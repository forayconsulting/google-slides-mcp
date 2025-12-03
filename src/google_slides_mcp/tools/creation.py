"""Creation tools for adding elements to Google Slides.

Tools for creating slides, text boxes, images, and shapes with
intuitive parameters using inches instead of EMUs.
"""

from typing import TYPE_CHECKING, Literal
import uuid

if TYPE_CHECKING:
    from fastmcp import Context, FastMCP


# Predefined slide layouts
LAYOUT_TYPES = Literal[
    "BLANK",
    "TITLE",
    "TITLE_AND_BODY",
    "TITLE_AND_TWO_COLUMNS",
    "TITLE_ONLY",
    "SECTION_HEADER",
    "ONE_COLUMN_TEXT",
    "MAIN_POINT",
    "BIG_NUMBER",
    "CAPTION_ONLY",
]


def register_creation_tools(mcp: "FastMCP") -> None:
    """Register creation tools with the MCP application.

    Args:
        mcp: The FastMCP application instance
    """

    @mcp.tool()
    async def create_slide(
        presentation_id: str,
        layout: LAYOUT_TYPES = "BLANK",
        insertion_index: int | None = None,
        ctx: "Context",
    ) -> dict:
        """Create a new slide with the specified layout.

        Args:
            presentation_id: The presentation to add the slide to
            layout: The layout type for the new slide
            insertion_index: Position to insert (None = append at end)

        Returns:
            Dictionary with:
            - slide_id: ID of the new slide
            - placeholder_ids: Mapping of placeholder types to their IDs
        """
        from google_slides_mcp.auth.middleware import GoogleAuthMiddleware
        from google_slides_mcp.services.slides_service import SlidesService

        middleware = GoogleAuthMiddleware()
        credentials = await middleware.extract_credentials(ctx)
        service = SlidesService(credentials)

        # Get presentation to find the layout
        presentation = await service.get_presentation(presentation_id)

        # Find matching layout
        layout_id = None
        for layout_obj in presentation.get("layouts", []):
            layout_props = layout_obj.get("layoutProperties", {})
            if layout_props.get("name", "").upper() == layout:
                layout_id = layout_obj.get("objectId")
                break

        # Generate a unique ID for the new slide
        slide_id = f"slide_{uuid.uuid4().hex[:8]}"

        request: dict = {
            "createSlide": {
                "objectId": slide_id,
                "slideLayoutReference": {"predefinedLayout": layout},
            }
        }

        if layout_id:
            request["createSlide"]["slideLayoutReference"] = {"layoutId": layout_id}

        if insertion_index is not None:
            request["createSlide"]["insertionIndex"] = insertion_index

        await service.batch_update(presentation_id, [request])

        # Get the created slide to find placeholder IDs
        slide_info = await service.get_page(presentation_id, slide_id)
        placeholder_ids = {}
        for element in slide_info.get("pageElements", []):
            placeholder = element.get("shape", {}).get("placeholder", {})
            if placeholder:
                placeholder_type = placeholder.get("type", "UNKNOWN")
                placeholder_ids[placeholder_type] = element.get("objectId")

        return {
            "slide_id": slide_id,
            "placeholder_ids": placeholder_ids,
        }

    @mcp.tool()
    async def add_text_box(
        presentation_id: str,
        slide_id: str,
        text: str,
        x: float = 1.0,
        y: float = 1.0,
        width: float = 4.0,
        height: float = 1.0,
        font_size: int = 18,
        font_family: str = "Arial",
        bold: bool = False,
        italic: bool = False,
        color: str = "#000000",
        alignment: Literal["LEFT", "CENTER", "RIGHT"] = "LEFT",
        ctx: "Context",
    ) -> dict:
        """Add a text box with styling to a slide.

        Args:
            presentation_id: The presentation ID
            slide_id: The slide to add the text box to
            text: The text content
            x: X position in inches from left edge
            y: Y position in inches from top edge
            width: Width in inches
            height: Height in inches
            font_size: Font size in points
            font_family: Font family name
            bold: Whether text is bold
            italic: Whether text is italic
            color: Text color as hex (e.g., "#FF0000")
            alignment: Text alignment within the box

        Returns:
            Dictionary with the created element ID
        """
        from google_slides_mcp.auth.middleware import GoogleAuthMiddleware
        from google_slides_mcp.services.slides_service import SlidesService
        from google_slides_mcp.utils.colors import hex_to_rgb
        from google_slides_mcp.utils.units import inches_to_emu, points_to_emu

        middleware = GoogleAuthMiddleware()
        credentials = await middleware.extract_credentials(ctx)
        service = SlidesService(credentials)

        # Generate unique ID
        element_id = f"textbox_{uuid.uuid4().hex[:8]}"

        requests = [
            # Create the text box shape
            {
                "createShape": {
                    "objectId": element_id,
                    "shapeType": "TEXT_BOX",
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
                }
            },
            # Insert the text
            {
                "insertText": {
                    "objectId": element_id,
                    "text": text,
                    "insertionIndex": 0,
                }
            },
            # Style the text
            {
                "updateTextStyle": {
                    "objectId": element_id,
                    "style": {
                        "fontFamily": font_family,
                        "fontSize": {"magnitude": font_size, "unit": "PT"},
                        "bold": bold,
                        "italic": italic,
                        "foregroundColor": {
                            "opaqueColor": {"rgbColor": hex_to_rgb(color)}
                        },
                    },
                    "fields": "fontFamily,fontSize,bold,italic,foregroundColor",
                    "textRange": {"type": "ALL"},
                }
            },
            # Set paragraph alignment
            {
                "updateParagraphStyle": {
                    "objectId": element_id,
                    "style": {"alignment": alignment},
                    "fields": "alignment",
                    "textRange": {"type": "ALL"},
                }
            },
        ]

        await service.batch_update(presentation_id, requests)

        return {"element_id": element_id}

    @mcp.tool()
    async def add_image(
        presentation_id: str,
        slide_id: str,
        image_url: str,
        x: float | None = None,
        y: float | None = None,
        width: float | None = None,
        height: float | None = None,
        horizontal_align: Literal["left", "center", "right"] | None = None,
        vertical_align: Literal["top", "center", "bottom"] | None = None,
        ctx: "Context",
    ) -> dict:
        """Add an image to a slide from a URL.

        If only width OR height is specified, aspect ratio is preserved.
        Use alignment for quick positioning without calculating coordinates.

        Args:
            presentation_id: The presentation ID
            slide_id: The slide to add the image to
            image_url: URL of the image (must be publicly accessible)
            x: X position in inches (optional if using alignment)
            y: Y position in inches (optional if using alignment)
            width: Width in inches (optional, preserves aspect ratio)
            height: Height in inches (optional, preserves aspect ratio)
            horizontal_align: Horizontal alignment on slide
            vertical_align: Vertical alignment on slide

        Returns:
            Dictionary with the created element ID
        """
        from google_slides_mcp.auth.middleware import GoogleAuthMiddleware
        from google_slides_mcp.services.slides_service import SlidesService
        from google_slides_mcp.utils.transforms import (
            SLIDE_SIZES,
            calculate_alignment_position,
        )
        from google_slides_mcp.utils.units import inches_to_emu

        middleware = GoogleAuthMiddleware()
        credentials = await middleware.extract_credentials(ctx)
        service = SlidesService(credentials)

        # Generate unique ID
        element_id = f"image_{uuid.uuid4().hex[:8]}"

        # Default size if not specified
        default_width = 4.0
        default_height = 3.0

        img_width = width if width is not None else default_width
        img_height = height if height is not None else default_height

        # Calculate position
        slide_size = SLIDE_SIZES["16:9"]

        if horizontal_align is not None or vertical_align is not None:
            pos_x, pos_y = calculate_alignment_position(
                slide_size,
                inches_to_emu(img_width),
                inches_to_emu(img_height),
                horizontal=horizontal_align,
                vertical=vertical_align,
            )
        else:
            pos_x = inches_to_emu(x if x is not None else 1.0)
            pos_y = inches_to_emu(y if y is not None else 1.0)

        request = {
            "createImage": {
                "objectId": element_id,
                "url": image_url,
                "elementProperties": {
                    "pageObjectId": slide_id,
                    "size": {
                        "width": {"magnitude": inches_to_emu(img_width), "unit": "EMU"},
                        "height": {"magnitude": inches_to_emu(img_height), "unit": "EMU"},
                    },
                    "transform": {
                        "scaleX": 1,
                        "scaleY": 1,
                        "shearX": 0,
                        "shearY": 0,
                        "translateX": pos_x,
                        "translateY": pos_y,
                        "unit": "EMU",
                    },
                },
            }
        }

        await service.batch_update(presentation_id, [request])

        return {"element_id": element_id}

    @mcp.tool()
    async def add_shape(
        presentation_id: str,
        slide_id: str,
        shape_type: str,
        x: float,
        y: float,
        width: float,
        height: float,
        fill_color: str | None = None,
        outline_color: str | None = "#000000",
        outline_weight: float = 1.0,
        ctx: "Context",
    ) -> dict:
        """Add a shape to a slide.

        Args:
            presentation_id: The presentation ID
            slide_id: The slide to add the shape to
            shape_type: Shape type (RECTANGLE, ELLIPSE, TRIANGLE, STAR_5, etc.)
                See Google Slides API ShapeType enum for full list.
            x: X position in inches
            y: Y position in inches
            width: Width in inches
            height: Height in inches
            fill_color: Fill color as hex (None for no fill)
            outline_color: Outline color as hex (None for no outline)
            outline_weight: Outline weight in points

        Returns:
            Dictionary with the created element ID
        """
        from google_slides_mcp.auth.middleware import GoogleAuthMiddleware
        from google_slides_mcp.services.slides_service import SlidesService
        from google_slides_mcp.utils.colors import hex_to_rgb
        from google_slides_mcp.utils.units import inches_to_emu, points_to_emu

        middleware = GoogleAuthMiddleware()
        credentials = await middleware.extract_credentials(ctx)
        service = SlidesService(credentials)

        # Generate unique ID
        element_id = f"shape_{uuid.uuid4().hex[:8]}"

        requests = [
            {
                "createShape": {
                    "objectId": element_id,
                    "shapeType": shape_type,
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
                }
            }
        ]

        # Build shape properties update
        shape_props: dict = {}
        fields = []

        if fill_color is not None:
            shape_props["shapeBackgroundFill"] = {
                "solidFill": {"color": {"rgbColor": hex_to_rgb(fill_color)}}
            }
            fields.append("shapeBackgroundFill")

        if outline_color is not None:
            shape_props["outline"] = {
                "outlineFill": {
                    "solidFill": {"color": {"rgbColor": hex_to_rgb(outline_color)}}
                },
                "weight": {"magnitude": outline_weight, "unit": "PT"},
            }
            fields.append("outline")

        if fields:
            requests.append(
                {
                    "updateShapeProperties": {
                        "objectId": element_id,
                        "shapeProperties": shape_props,
                        "fields": ",".join(fields),
                    }
                }
            )

        await service.batch_update(presentation_id, requests)

        return {"element_id": element_id}
