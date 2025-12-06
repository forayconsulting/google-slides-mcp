"""Semantic positioning tools for Google Slides.

These tools abstract away EMU calculations and transform math, providing
intuitive positioning using inches and alignment keywords.
"""

from typing import TYPE_CHECKING, Literal

from fastmcp import Context

if TYPE_CHECKING:
    from fastmcp import FastMCP


def register_positioning_tools(mcp: "FastMCP") -> None:
    """Register positioning tools with the MCP application.

    Args:
        mcp: The FastMCP application instance
    """

    @mcp.tool()
    async def position_element(
        ctx: Context,
        presentation_id: str,
        element_id: str,
        x: float | None = None,
        y: float | None = None,
        width: float | None = None,
        height: float | None = None,
        horizontal_align: Literal["left", "center", "right"] | None = None,
        vertical_align: Literal["top", "center", "bottom"] | None = None,
    ) -> dict:
        """Position and size an element using inches and alignment.

        All positions/sizes in INCHES (EMU conversion handled internally).
        Standard slide: 10" x 5.625". You can specify absolute coordinates
        OR alignment OR both.

        Args:
            presentation_id: The presentation containing the element
            element_id: The page element to position
            x: X position in inches from left edge
            y: Y position in inches from top edge
            width: New width in inches (None to preserve current)
            height: New height in inches (None to preserve current)
            horizontal_align: Align relative to slide width
            vertical_align: Align relative to slide height

        Returns:
            Updated element position and size in inches
        """
        from google_slides_mcp.auth.middleware import GoogleAuthMiddleware
        from google_slides_mcp.services.slides_service import SlidesService
        from google_slides_mcp.utils.transforms import (
            SLIDE_SIZES,
            build_absolute_transform,
            calculate_alignment_position,
            extract_element_bounds,
        )
        from google_slides_mcp.utils.units import emu_to_inches, inches_to_emu

        middleware = GoogleAuthMiddleware()
        credentials = await middleware.extract_credentials(ctx)
        service = SlidesService(credentials)

        # Get current presentation and element info
        presentation = await service.get_presentation(presentation_id)

        # Find the element in the presentation
        element = None
        for slide in presentation.get("slides", []):
            for page_element in slide.get("pageElements", []):
                if page_element.get("objectId") == element_id:
                    element = page_element
                    break
            if element:
                break

        if not element:
            raise ValueError(f"Element {element_id} not found in presentation")

        # Get current bounds
        current_x, current_y, current_width, current_height = extract_element_bounds(
            element
        )

        # Calculate new dimensions
        new_width = inches_to_emu(width) if width is not None else current_width
        new_height = inches_to_emu(height) if height is not None else current_height

        # Determine slide size (default to 16:9)
        slide_size = SLIDE_SIZES["16:9"]
        page_size = presentation.get("pageSize", {})
        if page_size:
            slide_size_width = page_size.get("width", {}).get("magnitude", 0)
            slide_size_height = page_size.get("height", {}).get("magnitude", 0)
            if slide_size_width and slide_size_height:
                from google_slides_mcp.utils.transforms import SlideSize

                slide_size = SlideSize(int(slide_size_width), int(slide_size_height))

        # Calculate position
        if horizontal_align is not None or vertical_align is not None:
            new_x, new_y = calculate_alignment_position(
                slide_size,
                new_width,
                new_height,
                horizontal=horizontal_align,
                vertical=vertical_align,
            )
            # Override with explicit coordinates if provided
            if x is not None:
                new_x = inches_to_emu(x)
            if y is not None:
                new_y = inches_to_emu(y)
        else:
            new_x = inches_to_emu(x) if x is not None else current_x
            new_y = inches_to_emu(y) if y is not None else current_y

        # Build transform
        transform = build_absolute_transform(new_x, new_y)

        # Create update request
        requests = [
            {
                "updatePageElementTransform": {
                    "objectId": element_id,
                    "transform": transform,
                    "applyMode": "ABSOLUTE",
                }
            }
        ]

        # Add size update if needed
        if width is not None or height is not None:
            requests.append(
                {
                    "updatePageElementTransform": {
                        "objectId": element_id,
                        "transform": {
                            "scaleX": new_width / current_width if current_width else 1,
                            "scaleY": (
                                new_height / current_height if current_height else 1
                            ),
                            "shearX": 0,
                            "shearY": 0,
                            "translateX": new_x,
                            "translateY": new_y,
                            "unit": "EMU",
                        },
                        "applyMode": "ABSOLUTE",
                    }
                }
            )

        await service.batch_update(presentation_id, requests)

        return {
            "element_id": element_id,
            "position": {"x_inches": emu_to_inches(new_x), "y_inches": emu_to_inches(new_y)},
            "size": {
                "width_inches": emu_to_inches(new_width),
                "height_inches": emu_to_inches(new_height),
            },
        }

    @mcp.tool()
    async def distribute_elements(
        ctx: Context,
        presentation_id: str,
        element_ids: list[str],
        direction: Literal["horizontal", "vertical"],
        spacing: float | Literal["even"] = "even",
    ) -> dict:
        """Distribute elements evenly across the slide.

        All measurements in INCHES (EMU conversion handled internally).

        Args:
            presentation_id: The presentation ID
            element_ids: Elements to distribute (order matters)
            direction: Distribution direction
            spacing: Fixed spacing in inches between elements, or "even"
                for equal distribution across the slide

        Returns:
            Dictionary with new positions for each element in inches
        """
        from google_slides_mcp.auth.middleware import GoogleAuthMiddleware
        from google_slides_mcp.services.slides_service import SlidesService
        from google_slides_mcp.utils.transforms import (
            SLIDE_SIZES,
            build_absolute_transform,
            extract_element_bounds,
        )
        from google_slides_mcp.utils.units import emu_to_inches, inches_to_emu

        middleware = GoogleAuthMiddleware()
        credentials = await middleware.extract_credentials(ctx)
        service = SlidesService(credentials)

        presentation = await service.get_presentation(presentation_id)

        # Get slide size
        slide_size = SLIDE_SIZES["16:9"]
        page_size = presentation.get("pageSize", {})
        if page_size:
            slide_size_width = page_size.get("width", {}).get("magnitude", 0)
            slide_size_height = page_size.get("height", {}).get("magnitude", 0)
            if slide_size_width and slide_size_height:
                from google_slides_mcp.utils.transforms import SlideSize

                slide_size = SlideSize(int(slide_size_width), int(slide_size_height))

        # Collect element info
        elements = []
        for slide in presentation.get("slides", []):
            for page_element in slide.get("pageElements", []):
                if page_element.get("objectId") in element_ids:
                    bounds = extract_element_bounds(page_element)
                    elements.append(
                        {
                            "id": page_element.get("objectId"),
                            "x": bounds[0],
                            "y": bounds[1],
                            "width": bounds[2],
                            "height": bounds[3],
                        }
                    )

        # Sort by provided order
        id_order = {id_: i for i, id_ in enumerate(element_ids)}
        elements.sort(key=lambda e: id_order.get(e["id"], 0))

        if len(elements) < 2:
            return {"error": "Need at least 2 elements to distribute"}

        # Calculate positions
        requests = []
        new_positions = []

        if direction == "horizontal":
            total_element_width = sum(e["width"] for e in elements)
            if spacing == "even":
                available_space = slide_size.width_emu - total_element_width
                gap = available_space / (len(elements) + 1)
            else:
                gap = inches_to_emu(spacing)

            current_x = int(gap)
            for elem in elements:
                transform = build_absolute_transform(current_x, elem["y"])
                requests.append(
                    {
                        "updatePageElementTransform": {
                            "objectId": elem["id"],
                            "transform": transform,
                            "applyMode": "ABSOLUTE",
                        }
                    }
                )
                new_positions.append(
                    {
                        "element_id": elem["id"],
                        "x_inches": emu_to_inches(current_x),
                        "y_inches": emu_to_inches(elem["y"]),
                    }
                )
                current_x += elem["width"] + int(gap)
        else:  # vertical
            total_element_height = sum(e["height"] for e in elements)
            if spacing == "even":
                available_space = slide_size.height_emu - total_element_height
                gap = available_space / (len(elements) + 1)
            else:
                gap = inches_to_emu(spacing)

            current_y = int(gap)
            for elem in elements:
                transform = build_absolute_transform(elem["x"], current_y)
                requests.append(
                    {
                        "updatePageElementTransform": {
                            "objectId": elem["id"],
                            "transform": transform,
                            "applyMode": "ABSOLUTE",
                        }
                    }
                )
                new_positions.append(
                    {
                        "element_id": elem["id"],
                        "x_inches": emu_to_inches(elem["x"]),
                        "y_inches": emu_to_inches(current_y),
                    }
                )
                current_y += elem["height"] + int(gap)

        if requests:
            await service.batch_update(presentation_id, requests)

        return {"elements": new_positions}

    @mcp.tool()
    async def align_elements(
        ctx: Context,
        presentation_id: str,
        element_ids: list[str],
        alignment: Literal["left", "center", "right", "top", "middle", "bottom"],
        reference: Literal["first", "last", "slide"] = "first",
    ) -> dict:
        """Align multiple elements to each other or to the slide.

        Results returned in INCHES.

        Args:
            element_ids: Elements to align
            alignment: Edge or center to align:
                - left/center/right: Horizontal alignment
                - top/middle/bottom: Vertical alignment
            reference: What to align to:
                - first: Align to the first element
                - last: Align to the last element
                - slide: Align to slide boundaries

        Returns:
            Dictionary with new positions for each element in inches
        """
        from google_slides_mcp.auth.middleware import GoogleAuthMiddleware
        from google_slides_mcp.services.slides_service import SlidesService
        from google_slides_mcp.utils.transforms import (
            SLIDE_SIZES,
            build_absolute_transform,
            extract_element_bounds,
        )
        from google_slides_mcp.utils.units import emu_to_inches

        middleware = GoogleAuthMiddleware()
        credentials = await middleware.extract_credentials(ctx)
        service = SlidesService(credentials)

        presentation = await service.get_presentation(presentation_id)

        # Get slide size
        slide_size = SLIDE_SIZES["16:9"]
        page_size = presentation.get("pageSize", {})
        if page_size:
            slide_size_width = page_size.get("width", {}).get("magnitude", 0)
            slide_size_height = page_size.get("height", {}).get("magnitude", 0)
            if slide_size_width and slide_size_height:
                from google_slides_mcp.utils.transforms import SlideSize

                slide_size = SlideSize(int(slide_size_width), int(slide_size_height))

        # Collect element info (preserving order)
        elements = []
        for elem_id in element_ids:
            for slide in presentation.get("slides", []):
                for page_element in slide.get("pageElements", []):
                    if page_element.get("objectId") == elem_id:
                        bounds = extract_element_bounds(page_element)
                        elements.append(
                            {
                                "id": elem_id,
                                "x": bounds[0],
                                "y": bounds[1],
                                "width": bounds[2],
                                "height": bounds[3],
                            }
                        )
                        break

        if len(elements) < 1:
            return {"error": "No elements found"}

        # Determine reference position
        if reference == "first":
            ref_elem = elements[0]
        elif reference == "last":
            ref_elem = elements[-1]
        else:  # slide
            ref_elem = {
                "x": 0,
                "y": 0,
                "width": slide_size.width_emu,
                "height": slide_size.height_emu,
            }

        # Calculate target position based on alignment
        requests = []
        new_positions = []

        for elem in elements:
            new_x = elem["x"]
            new_y = elem["y"]

            if alignment == "left":
                new_x = ref_elem["x"]
            elif alignment == "center":
                ref_center = ref_elem["x"] + ref_elem["width"] // 2
                new_x = ref_center - elem["width"] // 2
            elif alignment == "right":
                ref_right = ref_elem["x"] + ref_elem["width"]
                new_x = ref_right - elem["width"]
            elif alignment == "top":
                new_y = ref_elem["y"]
            elif alignment == "middle":
                ref_middle = ref_elem["y"] + ref_elem["height"] // 2
                new_y = ref_middle - elem["height"] // 2
            elif alignment == "bottom":
                ref_bottom = ref_elem["y"] + ref_elem["height"]
                new_y = ref_bottom - elem["height"]

            transform = build_absolute_transform(new_x, new_y)
            requests.append(
                {
                    "updatePageElementTransform": {
                        "objectId": elem["id"],
                        "transform": transform,
                        "applyMode": "ABSOLUTE",
                    }
                }
            )
            new_positions.append(
                {
                    "element_id": elem["id"],
                    "x_inches": emu_to_inches(new_x),
                    "y_inches": emu_to_inches(new_y),
                }
            )

        if requests:
            await service.batch_update(presentation_id, requests)

        return {"elements": new_positions}
