"""Google OAuth 2.1 provider configuration.

Sets up FastMCP's GoogleProvider for OAuth 2.1 authentication with
the required Google Slides and Drive API scopes.
"""

import os
from typing import TYPE_CHECKING

if TYPE_CHECKING:
    from fastmcp.server.auth.providers.google import GoogleProvider

# Required OAuth scopes for Google Slides operations
GOOGLE_SLIDES_SCOPES = [
    "openid",
    "https://www.googleapis.com/auth/userinfo.email",
    "https://www.googleapis.com/auth/presentations",  # Full Slides access
    "https://www.googleapis.com/auth/drive.file",  # Access to app-created files
]

# Alternative: Full Drive access (more permissive)
GOOGLE_FULL_DRIVE_SCOPES = [
    "openid",
    "https://www.googleapis.com/auth/userinfo.email",
    "https://www.googleapis.com/auth/presentations",
    "https://www.googleapis.com/auth/drive",  # Full Drive access
]


def get_google_oauth_provider(
    client_id: str | None = None,
    client_secret: str | None = None,
    base_url: str | None = None,
    use_full_drive_access: bool = False,
) -> "GoogleProvider":
    """Create a configured Google OAuth provider for FastMCP.

    Args:
        client_id: Google OAuth client ID (defaults to env var)
        client_secret: Google OAuth client secret (defaults to env var)
        base_url: Base URL for OAuth callbacks (defaults to env var)
        use_full_drive_access: If True, request full Drive access instead of
            limited drive.file scope

    Returns:
        Configured GoogleProvider instance

    Raises:
        ValueError: If required credentials are not provided
        ImportError: If FastMCP is not installed with auth support
    """
    try:
        from fastmcp.server.auth.providers.google import GoogleProvider
    except ImportError as e:
        raise ImportError(
            "FastMCP with auth support required. Install with: pip install 'fastmcp[auth]'"
        ) from e

    # Get credentials from environment if not provided
    client_id = client_id or os.getenv("GOOGLE_CLIENT_ID")
    client_secret = client_secret or os.getenv("GOOGLE_CLIENT_SECRET")
    base_url = base_url or os.getenv("MCP_BASE_URL", "http://localhost:8000")

    if not client_id or not client_secret:
        raise ValueError(
            "Google OAuth credentials required. Set GOOGLE_CLIENT_ID and "
            "GOOGLE_CLIENT_SECRET environment variables."
        )

    scopes = GOOGLE_FULL_DRIVE_SCOPES if use_full_drive_access else GOOGLE_SLIDES_SCOPES

    return GoogleProvider(
        client_id=client_id,
        client_secret=client_secret,
        base_url=base_url,
        required_scopes=scopes,
    )
