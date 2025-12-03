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
    ) -> dict:
        """Copy a file to create a new file.

        Used for copying presentation templates.

        Args:
            file_id: ID of the file to copy
            new_name: Name for the new file
            parent_folder_id: Optional folder ID for the copy

        Returns:
            The newly created file resource

        Raises:
            HttpError: If the API request fails
        """
        body: dict[str, Any] = {"name": new_name}
        if parent_folder_id:
            body["parents"] = [parent_folder_id]

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


def build_drive_service(credentials: Any) -> DriveService:
    """Factory function to create a DriveService.

    Args:
        credentials: Google OAuth credentials

    Returns:
        Configured DriveService instance
    """
    return DriveService(credentials)
