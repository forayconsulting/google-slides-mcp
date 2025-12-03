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

        Use this for full control when semantic tools don't cover your use case.
        All 47 Google Slides API request types are supported.

        See: https://developers.google.com/slides/api/reference/rest/v1/presentations/batchUpdate

        Args:
            presentation_id: The ID of the presentation to modify
            requests: Array of request objects (createSlide, insertText,
                updatePageElementTransform, etc.)

        Returns:
            batchUpdate response with replies for each request. The replies
            array maps 1:1 with the requests array.

        Example requests:
            - CreateSlideRequest: Create a new slide
            - InsertTextRequest: Add text to a shape
            - UpdatePageElementTransformRequest: Move/resize elements
            - ReplaceAllTextRequest: Find and replace text
            - CreateShapeRequest: Add shapes
            - CreateImageRequest: Insert images
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
        """Retrieve presentation metadata, slides, and elements.

        Args:
            presentation_id: The ID of the presentation to retrieve
            fields: Optional field mask for partial response
                (e.g., "slides.pageElements" to get only elements)

        Returns:
            Full presentation object or requested fields including:
            - presentationId: The presentation ID
            - pageSize: Slide dimensions
            - slides: Array of slide objects
            - title: Presentation title
            - masters: Master slide templates
            - layouts: Available layouts
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
        """Get detailed information about a specific slide/page.

        Returns page elements with their current transforms, sizes,
        and properties.

        Args:
            presentation_id: The ID of the presentation
            page_id: The object ID of the page/slide to retrieve

        Returns:
            Page object including:
            - objectId: The page ID
            - pageType: Type of page (SLIDE, MASTER, LAYOUT)
            - pageElements: Array of elements on the page
            - slideProperties: Slide-specific properties
            - pageProperties: Page background, color scheme
        """
        from google_slides_mcp.auth.middleware import GoogleAuthMiddleware
        from google_slides_mcp.services.slides_service import SlidesService

        middleware = GoogleAuthMiddleware()
        credentials = await middleware.extract_credentials(ctx)
        service = SlidesService(credentials)

        return await service.get_page(presentation_id, page_id)
