"""Cleanup tools for removing non-placeholder elements from slides."""

from __future__ import annotations

from typing import TYPE_CHECKING

from fastmcp import Context

if TYPE_CHECKING:
    from fastmcp import FastMCP


def register_cleanup_tools(mcp: "FastMCP") -> None:
    """Register cleanup tools with the MCP application."""

    @mcp.tool()
    async def clear_slide(
        ctx: Context,
        presentation_id: str,
        slide_id: str,
        keep_placeholders: bool = True,
    ) -> dict:
        """Remove non-placeholder elements from a slide.

        Useful after copy_template to clean up decorative elements
        (charts, images, icons) while preserving content placeholders
        (TITLE, BODY, etc.).

        Args:
            presentation_id: The presentation ID
            slide_id: The slide to clear
            keep_placeholders: If true (default), preserve placeholder elements;
                if false, delete everything

        Returns:
            Dictionary with elements_deleted and elements_kept counts
        """
        from google_slides_mcp.auth.middleware import GoogleAuthMiddleware
        from google_slides_mcp.services.slides_service import SlidesService

        middleware = GoogleAuthMiddleware()
        credentials = await middleware.extract_credentials(ctx)
        service = SlidesService(credentials)

        slide = await service.get_page(presentation_id, slide_id)

        delete_ids: list[str] = []
        kept_count = 0

        for element in slide.get("pageElements", []):
            is_placeholder = bool(
                element.get("shape", {}).get("placeholder", {}).get("type")
            )
            if keep_placeholders and is_placeholder:
                kept_count += 1
            else:
                obj_id = element.get("objectId")
                if obj_id:
                    delete_ids.append(obj_id)

        if delete_ids:
            requests = [{"deleteObject": {"objectId": oid}} for oid in delete_ids]
            await service.batch_update(presentation_id, requests)

        return {
            "elements_deleted": len(delete_ids),
            "elements_kept": kept_count,
        }
