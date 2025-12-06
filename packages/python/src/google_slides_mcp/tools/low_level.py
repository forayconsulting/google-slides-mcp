"""Low-level tools providing direct access to Google Slides API.

These tools expose the raw Google Slides API capabilities for power users
who need full control over their presentations.
"""

from typing import TYPE_CHECKING

from fastmcp import Context

if TYPE_CHECKING:
    from fastmcp import FastMCP


def register_low_level_tools(mcp: "FastMCP") -> None:
    """Register low-level API tools with the MCP application.

    Args:
        mcp: The FastMCP application instance
    """

    @mcp.tool()
    async def batch_update(
        ctx: Context,
        presentation_id: str,
        requests: list[dict],
    ) -> dict:
        """Execute raw batchUpdate requests against Google Slides API.

        WHEN TO USE: Only when semantic tools don't cover your use case.
        Common scenarios: deleting slides (deleteObject), table operations,
        animations, grouping elements.

        PREFER INSTEAD:
        - replace_placeholders for text replacement
        - update_slide_content for placeholder updates
        - position_element for moving/resizing

        All 47 Google Slides API request types are supported.

        See: https://developers.google.com/slides/api/reference/rest/v1/presentations/batchUpdate

        Args:
            presentation_id: The ID of the presentation to modify
            requests: Array of request objects (createSlide, insertText,
                updatePageElementTransform, etc.)

        Returns:
            batchUpdate response with replies for each request.
        """
        from google_slides_mcp.auth.middleware import GoogleAuthMiddleware
        from google_slides_mcp.services.slides_service import SlidesService

        middleware = GoogleAuthMiddleware()
        credentials = await middleware.extract_credentials(ctx)
        service = SlidesService(credentials)

        return await service.batch_update(presentation_id, requests)

    @mcp.tool()
    async def get_presentation(
        ctx: Context,
        presentation_id: str,
        fields: str | None = None,
    ) -> dict:
        """Retrieve raw presentation metadata, slides, and elements.

        Returns EMU units and raw API structures.

        PREFER INSTEAD:
        - list_slides for slide overview
        - analyze_presentation for style/structure analysis
        - get_element_info for element details in inches

        Args:
            presentation_id: The ID of the presentation to retrieve
            fields: Optional field mask for partial response
                (e.g., "slides.pageElements" to get only elements)

        Returns:
            Full presentation object or requested fields.
        """
        from google_slides_mcp.auth.middleware import GoogleAuthMiddleware
        from google_slides_mcp.services.slides_service import SlidesService

        middleware = GoogleAuthMiddleware()
        credentials = await middleware.extract_credentials(ctx)
        service = SlidesService(credentials)

        return await service.get_presentation(presentation_id, fields)

    @mcp.tool()
    async def get_page(
        ctx: Context,
        presentation_id: str,
        page_id: str,
    ) -> dict:
        """Get raw slide/page data with transforms and properties.

        Returns EMU units. Used internally by update_slide_content.

        PREFER INSTEAD:
        - get_element_info for element details in inches
        - list_slides for slide overview

        Args:
            presentation_id: The ID of the presentation
            page_id: The object ID of the page/slide to retrieve

        Returns:
            Page object with elements, transforms, and properties.
        """
        from google_slides_mcp.auth.middleware import GoogleAuthMiddleware
        from google_slides_mcp.services.slides_service import SlidesService

        middleware = GoogleAuthMiddleware()
        credentials = await middleware.extract_credentials(ctx)
        service = SlidesService(credentials)

        return await service.get_page(presentation_id, page_id)
