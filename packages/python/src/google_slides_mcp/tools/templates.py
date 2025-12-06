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
        convert_to_slides: bool = False,
    ) -> dict:
        """Copy a Google Slides template to create a new presentation.

        WORKFLOW TIP: After copying, use analyze_presentation to understand
        the template structure, then replace_placeholders or
        update_presentation_content to populate content.

        Can also convert PowerPoint (.pptx) files to native Google Slides format.

        Args:
            template_id: Source presentation ID to copy
            new_name: Name for the new presentation
            destination_folder_id: Optional Drive folder ID for the copy
            convert_to_slides: If True, convert the source file to Google Slides
                format. Use this when copying a .pptx file.

        Returns:
            Dictionary with:
            - presentation_id: ID of the new presentation
            - url: Direct URL to open the presentation
            - converted: Whether format conversion was performed
        """
        from google_slides_mcp.auth.middleware import GoogleAuthMiddleware
        from google_slides_mcp.services.drive_service import DriveService

        MIME_GOOGLE_SLIDES = "application/vnd.google-apps.presentation"

        middleware = GoogleAuthMiddleware()
        credentials = await middleware.extract_credentials(ctx)
        service = DriveService(credentials)

        result = await service.copy_file(
            file_id=template_id,
            new_name=new_name,
            parent_folder_id=destination_folder_id,
            target_mime_type=MIME_GOOGLE_SLIDES if convert_to_slides else None,
        )

        return {
            "presentation_id": result["id"],
            "url": f"https://docs.google.com/presentation/d/{result['id']}",
            "converted": convert_to_slides,
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

    @mcp.tool()
    async def search_presentations(
        ctx: Context,
        query: str | None = None,
        folder_id: str | None = None,
        max_results: int = 20,
        page_token: str | None = None,
    ) -> dict:
        """Search for presentations in Google Drive.

        TYPICAL WORKFLOW: search_presentations -> copy_template ->
        analyze_presentation -> replace_placeholders

        Use to discover templates or find existing presentations by name.
        Returns Google Slides presentations and PowerPoint files.

        Args:
            query: Search term to match against file names. If omitted,
                returns all accessible presentations.
            folder_id: Limit search to a specific folder ID
            max_results: Maximum number of results to return (1-100, default 20)
            page_token: Token for retrieving the next page of results

        Returns:
            Dictionary with:
            - presentations: List of presentation info with:
                - id: Presentation ID (use with copy_template)
                - name: File name
                - mimeType: File type
                - createdTime: ISO timestamp
                - modifiedTime: ISO timestamp
                - url: Direct URL to open
                - owner: Owner email (if available)
            - next_page_token: Token for next page (if more results)
            - total_returned: Number of results in this response
        """
        from google_slides_mcp.auth.middleware import GoogleAuthMiddleware
        from google_slides_mcp.services.drive_service import DriveService

        # Presentation MIME types
        MIME_GOOGLE_SLIDES = "application/vnd.google-apps.presentation"
        MIME_PPTX = "application/vnd.openxmlformats-officedocument.presentationml.presentation"

        middleware = GoogleAuthMiddleware()
        credentials = await middleware.extract_credentials(ctx)
        service = DriveService(credentials)

        result = await service.list_files(
            query=query,
            mime_types=[MIME_GOOGLE_SLIDES, MIME_PPTX],
            folder_id=folder_id,
            page_size=max_results,
            page_token=page_token,
        )

        # Transform response for better usability
        presentations = []
        for f in result.get("files", []):
            pres = {
                "id": f["id"],
                "name": f["name"],
                "mimeType": f["mimeType"],
                "createdTime": f.get("createdTime"),
                "modifiedTime": f.get("modifiedTime"),
                "url": f"https://docs.google.com/presentation/d/{f['id']}",
            }
            # Extract owner email if available
            owners = f.get("owners", [])
            if owners:
                pres["owner"] = owners[0].get("emailAddress")
            presentations.append(pres)

        return {
            "presentations": presentations,
            "next_page_token": result.get("nextPageToken"),
            "total_returned": len(presentations),
        }
