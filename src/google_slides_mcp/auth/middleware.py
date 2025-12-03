"""Authentication middleware for validating Google OAuth tokens."""

from typing import TYPE_CHECKING, Any

if TYPE_CHECKING:
    from fastmcp import Context


class GoogleAuthMiddleware:
    """Middleware for validating and processing Google OAuth tokens.

    This middleware extracts the Google credentials from the MCP context
    and makes them available to tools for API calls.
    """

    async def extract_credentials(self, ctx: "Context") -> Any:
        """Extract Google credentials from the context.

        The credentials are injected by FastMCP's GoogleProvider after
        successful OAuth authentication.

        Args:
            ctx: The MCP context containing auth information

        Returns:
            Google OAuth credentials object

        Raises:
            ValueError: If credentials are not available
        """
        # FastMCP stores auth info in the context
        auth_info = getattr(ctx, "auth", None)
        if not auth_info:
            raise ValueError("Authentication required. No credentials in context.")

        # The GoogleProvider stores credentials in auth context
        credentials = auth_info.get("credentials")
        if not credentials:
            raise ValueError("Google credentials not found in auth context.")

        return credentials

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


def get_credentials_from_context(ctx: "Context") -> Any:
    """Helper function to extract credentials from MCP context.

    Args:
        ctx: The MCP context

    Returns:
        Google credentials object

    Raises:
        ValueError: If credentials are not available
    """
    middleware = GoogleAuthMiddleware()
    # Note: This is a sync wrapper - in actual use, call extract_credentials
    return middleware.extract_credentials(ctx)
