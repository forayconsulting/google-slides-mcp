"""Google Drive API service wrapper.

Provides a clean interface to Google Drive API operations needed for
template copying and file management.
"""

from typing import Any

from googleapiclient.discovery import Resource, build
from googleapiclient.errors import HttpError


class DriveService:
    """Wrapper for Google Drive API operations."""

    def __init__(self, credentials: Any) -> None:
        """Initialize the Drive service with credentials.

        Args:
            credentials: Google OAuth credentials object
        """
        self._service: Resource = build("drive", "v3", credentials=credentials)

    @property
    def files(self) -> Resource:
        """Access the files resource."""
        return self._service.files()

    async def copy_file(
        self,
        file_id: str,
        new_name: str,
        parent_folder_id: str | None = None,
        target_mime_type: str | None = None,
    ) -> dict:
        """Copy a file to create a new file.

        Used for copying presentation templates. Can also convert between
        formats by specifying a target MIME type.

        Args:
            file_id: ID of the file to copy
            new_name: Name for the new file
            parent_folder_id: Optional folder ID for the copy
            target_mime_type: Optional target MIME type for conversion
                (e.g., 'application/vnd.google-apps.presentation' to
                convert PPTX to Google Slides)

        Returns:
            The newly created file resource

        Raises:
            HttpError: If the API request fails
        """
        body: dict[str, Any] = {"name": new_name}
        if parent_folder_id:
            body["parents"] = [parent_folder_id]
        if target_mime_type:
            body["mimeType"] = target_mime_type

        return self.files.copy(fileId=file_id, body=body).execute()

    async def get_file(
        self,
        file_id: str,
        fields: str = "id,name,mimeType",
    ) -> dict:
        """Get file metadata.

        Args:
            file_id: ID of the file
            fields: Fields to include in response

        Returns:
            File metadata dictionary

        Raises:
            HttpError: If the API request fails
        """
        return self.files.get(fileId=file_id, fields=fields).execute()

    async def export_file(
        self,
        file_id: str,
        mime_type: str,
    ) -> bytes:
        """Export a Google Workspace file to a different format.

        Args:
            file_id: ID of the file to export
            mime_type: Target MIME type (e.g., "application/pdf")

        Returns:
            File content as bytes

        Raises:
            HttpError: If the API request fails
        """
        return self.files.export(fileId=file_id, mimeType=mime_type).execute()

    async def list_files(
        self,
        query: str | None = None,
        mime_types: list[str] | None = None,
        folder_id: str | None = None,
        page_size: int = 20,
        page_token: str | None = None,
        include_trashed: bool = False,
    ) -> dict:
        """List files matching the given criteria.

        Args:
            query: Optional search query (applied to file name)
            mime_types: List of MIME types to filter by
            folder_id: Optional folder ID to search within
            page_size: Maximum number of results (1-100)
            page_token: Token for pagination
            include_trashed: Whether to include trashed files

        Returns:
            Dictionary with:
            - files: List of file metadata dictionaries
            - nextPageToken: Token for next page (if more results)

        Raises:
            HttpError: If the API request fails
        """
        # Build query clauses
        clauses: list[str] = []

        if query:
            # Escape single quotes in the query
            escaped_query = query.replace("'", "\\'")
            clauses.append(f"name contains '{escaped_query}'")

        if mime_types:
            mime_conditions = " or ".join(
                f"mimeType = '{mt}'" for mt in mime_types
            )
            clauses.append(f"({mime_conditions})")

        if folder_id:
            clauses.append(f"'{folder_id}' in parents")

        if not include_trashed:
            clauses.append("trashed = false")

        # Combine clauses with AND
        q = " and ".join(clauses) if clauses else None

        # Clamp page_size to valid range
        page_size = max(1, min(100, page_size))

        # Build request parameters
        params: dict[str, Any] = {
            "pageSize": page_size,
            "fields": "nextPageToken,files(id,name,mimeType,createdTime,modifiedTime,owners)",
        }
        if q:
            params["q"] = q
        if page_token:
            params["pageToken"] = page_token

        return self.files.list(**params).execute()


def build_drive_service(credentials: Any) -> DriveService:
    """Factory function to create a DriveService.

    Args:
        credentials: Google OAuth credentials

    Returns:
        Configured DriveService instance
    """
    return DriveService(credentials)
