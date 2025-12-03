"""Google Slides API service wrapper.

Provides a clean interface to the Google Slides API with credential injection
from the MCP context.
"""

from typing import Any

from googleapiclient.discovery import Resource, build
from googleapiclient.errors import HttpError


class SlidesService:
    """Wrapper for Google Slides API operations."""

    def __init__(self, credentials: Any) -> None:
        """Initialize the Slides service with credentials.

        Args:
            credentials: Google OAuth credentials object
        """
        self._service: Resource = build("slides", "v1", credentials=credentials)

    @property
    def presentations(self) -> Resource:
        """Access the presentations resource."""
        return self._service.presentations()

    async def get_presentation(
        self,
        presentation_id: str,
        fields: str | None = None,
    ) -> dict:
        """Retrieve a presentation.

        Args:
            presentation_id: The ID of the presentation to retrieve
            fields: Optional field mask for partial response

        Returns:
            Presentation resource dictionary

        Raises:
            HttpError: If the API request fails
        """
        request = self.presentations.get(presentationId=presentation_id)
        if fields:
            request = self.presentations.get(
                presentationId=presentation_id,
                fields=fields,
            )
        return request.execute()

    async def get_page(
        self,
        presentation_id: str,
        page_id: str,
    ) -> dict:
        """Retrieve a specific page/slide from a presentation.

        Args:
            presentation_id: The ID of the presentation
            page_id: The ID of the page to retrieve

        Returns:
            Page resource dictionary

        Raises:
            HttpError: If the API request fails
        """
        return (
            self.presentations.pages().get(
                presentationId=presentation_id,
                pageObjectId=page_id,
            )
        ).execute()

    async def batch_update(
        self,
        presentation_id: str,
        requests: list[dict],
    ) -> dict:
        """Execute a batch update on a presentation.

        Args:
            presentation_id: The ID of the presentation to update
            requests: List of update request objects

        Returns:
            BatchUpdate response with replies for each request

        Raises:
            HttpError: If the API request fails
        """
        body = {"requests": requests}
        return (
            self.presentations.batchUpdate(
                presentationId=presentation_id,
                body=body,
            )
        ).execute()

    async def create_presentation(
        self,
        title: str,
    ) -> dict:
        """Create a new presentation.

        Args:
            title: Title for the new presentation

        Returns:
            Created presentation resource

        Raises:
            HttpError: If the API request fails
        """
        body = {"title": title}
        return self.presentations.create(body=body).execute()


def build_slides_service(credentials: Any) -> SlidesService:
    """Factory function to create a SlidesService.

    Args:
        credentials: Google OAuth credentials

    Returns:
        Configured SlidesService instance
    """
    return SlidesService(credentials)
