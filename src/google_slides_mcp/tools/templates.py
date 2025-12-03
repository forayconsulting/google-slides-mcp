"""Template operation tools for Google Slides.

Tools for working with presentation templates: copying, finding and
replacing placeholder text and images.
"""

from typing import TYPE_CHECKING, Literal

from fastmcp import Context

if TYPE_CHECKING:
    from fastmcp import FastMCP


def register_template_tools(mcp: "FastMCP") -> None:
    """Register template tools with the MCP application.

    Args:
        mcp: The FastMCP application instance
    """

    @mcp.tool()
    async def copy_template(
        ctx: Context,
        template_id: str,
        new_name: str,
        destination_folder_id: str | None = None,
    ) -> dict:
        """Copy a Google Slides template to create a new presentation.

        Args:
            template_id: Source presentation ID to copy
            new_name: Name for the new presentation
            destination_folder_id: Optional Drive folder ID for the copy

        Returns:
            Dictionary with:
            - presentation_id: ID of the new presentation
            - url: Direct URL to open the presentation
        """
        from google_slides_mcp.auth.middleware import GoogleAuthMiddleware
        from google_slides_mcp.services.drive_service import DriveService

        middleware = GoogleAuthMiddleware()
        credentials = await middleware.extract_credentials(ctx)
        service = DriveService(credentials)

        result = await service.copy_file(
            file_id=template_id,
            new_name=new_name,
            parent_folder_id=destination_folder_id,
        )

        return {
            "presentation_id": result["id"],
            "url": f"https://docs.google.com/presentation/d/{result['id']}",
        }

    @mcp.tool()
    async def replace_placeholders(
        ctx: Context,
        presentation_id: str,
        replacements: dict[str, str],
    ) -> dict:
        """Replace placeholder text throughout a presentation.

        Placeholders can use any format ({{name}}, {name}, [[name]], etc.).
        The tool will find and replace all occurrences across all slides.

        Args:
            presentation_id: The presentation to modify
            replacements: Mapping of placeholder strings to replacement values
                Example: {"{{name}}": "Acme Corp", "{{date}}": "2024"}

        Returns:
            Dictionary with count of replacements made for each placeholder
        """
        from google_slides_mcp.auth.middleware import GoogleAuthMiddleware
        from google_slides_mcp.services.slides_service import SlidesService

        middleware = GoogleAuthMiddleware()
        credentials = await middleware.extract_credentials(ctx)
        service = SlidesService(credentials)

        # Build replaceAllText requests
        requests = [
            {
                "replaceAllText": {
                    "containsText": {"text": placeholder, "matchCase": True},
                    "replaceText": replacement,
                }
            }
            for placeholder, replacement in replacements.items()
        ]

        response = await service.batch_update(presentation_id, requests)

        # Extract replacement counts from response
        counts = {}
        for i, (placeholder, _) in enumerate(replacements.items()):
            reply = response.get("replies", [])[i]
            occurrences = reply.get("replaceAllText", {}).get("occurrencesChanged", 0)
            counts[placeholder] = occurrences

        return {"replacements": counts, "total": sum(counts.values())}

    @mcp.tool()
    async def replace_placeholder_with_image(
        ctx: Context,
        presentation_id: str,
        placeholder_text: str,
        image_url: str,
        replace_method: Literal["CENTER_INSIDE", "CENTER_CROP"] = "CENTER_INSIDE",
    ) -> dict:
        """Replace all shapes containing placeholder text with an image.

        The image will be sized to fit the placeholder shape's bounds.

        Args:
            presentation_id: The presentation to modify
            placeholder_text: Text to search for in shapes
            image_url: URL of the image to insert (must be publicly accessible)
            replace_method: How to fit the image:
                - CENTER_INSIDE: Scale to fit inside shape, maintaining aspect ratio
                - CENTER_CROP: Scale to fill shape, cropping as needed

        Returns:
            Dictionary with count of shapes replaced
        """
        from google_slides_mcp.auth.middleware import GoogleAuthMiddleware
        from google_slides_mcp.services.slides_service import SlidesService

        middleware = GoogleAuthMiddleware()
        credentials = await middleware.extract_credentials(ctx)
        service = SlidesService(credentials)

        requests = [
            {
                "replaceAllShapesWithImage": {
                    "imageUrl": image_url,
                    "replaceMethod": replace_method,
                    "containsText": {"text": placeholder_text, "matchCase": True},
                }
            }
        ]

        response = await service.batch_update(presentation_id, requests)

        reply = response.get("replies", [{}])[0]
        occurrences = (
            reply.get("replaceAllShapesWithImage", {}).get("occurrencesChanged", 0)
        )

        return {"shapes_replaced": occurrences}
