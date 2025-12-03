"""Authentication middleware for validating Google OAuth tokens."""

import json
import os
from datetime import datetime
from pathlib import Path
from typing import TYPE_CHECKING, Any

from google.oauth2.credentials import Credentials

if TYPE_CHECKING:
    from fastmcp import Context

# Default credentials storage location
CREDENTIALS_DIR = Path(os.path.expanduser("~/.google-slides-mcp"))
CREDENTIALS_FILE = CREDENTIALS_DIR / "credentials.json"


class GoogleAuthMiddleware:
    """Middleware for validating and processing Google OAuth tokens.

    This middleware extracts the Google credentials from the MCP context
    and makes them available to tools for API calls.

    For stdio transport, it falls back to loading stored credentials from
    ~/.google-slides-mcp/credentials.json
    """

    def __init__(self, credentials_file: Path | None = None):
        """Initialize the middleware.

        Args:
            credentials_file: Optional path to stored credentials file
        """
        self._credentials_file = credentials_file or CREDENTIALS_FILE
        self._cached_credentials: Credentials | None = None

    async def extract_credentials(self, ctx: "Context") -> Credentials:
        """Extract Google credentials from the context or stored file.

        First tries to get credentials from the MCP context (OAuth 2.1 flow).
        If not available, falls back to loading stored credentials from file.

        Args:
            ctx: The MCP context containing auth information

        Returns:
            Google OAuth credentials object

        Raises:
            ValueError: If credentials are not available
        """
        # Try to get credentials from context (OAuth 2.1 flow)
        auth_info = getattr(ctx, "auth", None)
        if auth_info:
            credentials = auth_info.get("credentials")
            if credentials:
                return credentials

        # Fall back to stored credentials (stdio transport)
        return await self._load_stored_credentials()

    async def _load_stored_credentials(self) -> Credentials:
        """Load credentials from the stored credentials file.

        Returns:
            Google OAuth credentials object

        Raises:
            ValueError: If credentials file doesn't exist or is invalid
        """
        # Return cached credentials if still valid
        if self._cached_credentials and self._cached_credentials.valid:
            return self._cached_credentials

        if not self._credentials_file.exists():
            raise ValueError(
                f"No credentials found. Run 'python scripts/get_token.py' to authenticate.\n"
                f"Expected credentials at: {self._credentials_file}"
            )

        try:
            with open(self._credentials_file) as f:
                creds_data = json.load(f)
        except json.JSONDecodeError as e:
            raise ValueError(f"Invalid credentials file: {e}") from e

        # Build credentials object
        credentials = Credentials(
            token=creds_data.get("token"),
            refresh_token=creds_data.get("refresh_token"),
            token_uri=creds_data.get("token_uri", "https://oauth2.googleapis.com/token"),
            client_id=creds_data.get("client_id"),
            client_secret=creds_data.get("client_secret"),
            scopes=creds_data.get("scopes"),
        )

        # Refresh if expired
        if credentials.expired and credentials.refresh_token:
            from google.auth.transport.requests import Request

            credentials.refresh(Request())
            # Update stored credentials with new token
            await self._save_credentials(credentials, creds_data)

        self._cached_credentials = credentials
        return credentials

    async def _save_credentials(self, credentials: Credentials, original_data: dict) -> None:
        """Save updated credentials back to file.

        Args:
            credentials: The credentials object with updated tokens
            original_data: Original credentials data to preserve other fields
        """
        original_data["token"] = credentials.token
        if credentials.expiry:
            original_data["expiry"] = credentials.expiry.isoformat()

        with open(self._credentials_file, "w") as f:
            json.dump(original_data, f, indent=2)

    async def validate_token(self, token: str) -> dict:
        """Validate a Google OAuth token.

        Args:
            token: Bearer token to validate

        Returns:
            Token info dictionary from Google

        Raises:
            ValueError: If token is invalid or expired
        """
        import httpx

        async with httpx.AsyncClient() as client:
            response = await client.get(
                "https://oauth2.googleapis.com/tokeninfo",
                params={"access_token": token},
            )

            if response.status_code != 200:
                raise ValueError(f"Invalid token: {response.text}")

            return response.json()


# Global middleware instance for convenience
_middleware = GoogleAuthMiddleware()


async def get_credentials_from_context(ctx: "Context") -> Credentials:
    """Helper function to extract credentials from MCP context.

    Args:
        ctx: The MCP context

    Returns:
        Google credentials object

    Raises:
        ValueError: If credentials are not available
    """
    return await _middleware.extract_credentials(ctx)
