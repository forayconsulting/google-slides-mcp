"""FastMCP server entry point for Google Slides MCP.

This module sets up the FastMCP application with OAuth authentication
and registers all tools.
"""

import argparse
import logging
import sys
from typing import TYPE_CHECKING

from fastmcp import FastMCP

from google_slides_mcp.config import Settings, get_settings
from google_slides_mcp.prompts import register_all_prompts
from google_slides_mcp.tools import register_all_tools

if TYPE_CHECKING:
    pass

# Configure logging
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s - %(name)s - %(levelname)s - %(message)s",
)
logger = logging.getLogger(__name__)


def create_app(settings: Settings | None = None) -> FastMCP:
    """Create and configure the FastMCP application.

    Args:
        settings: Optional settings instance (uses defaults if not provided)

    Returns:
        Configured FastMCP application
    """
    if settings is None:
        settings = get_settings()

    # Configure logging level
    logging.getLogger().setLevel(settings.log_level)

    # Create auth provider if OAuth is enabled
    auth = None
    if settings.mcp_enable_oauth21 and settings.has_oauth_credentials():
        try:
            from google_slides_mcp.auth.google_oauth import get_google_oauth_provider

            auth = get_google_oauth_provider(
                client_id=settings.google_client_id,
                client_secret=settings.google_client_secret,
                base_url=settings.mcp_base_url,
            )
            logger.info("OAuth 2.1 authentication enabled")
        except ImportError:
            logger.warning(
                "FastMCP auth providers not available. "
                "Install with: pip install 'fastmcp[auth]'"
            )
        except Exception as e:
            logger.warning(f"Failed to configure OAuth: {e}")

    # Create the FastMCP application
    mcp = FastMCP(
        name="Google Slides MCP",
        instructions=(
            "Google Slides MCP Server provides tools for creating and manipulating "
            "Google Slides presentations. Use the semantic tools (position_element, "
            "add_text_box, etc.) for common operations, or use batch_update for "
            "full API access.\n\n"
            "## Critical Behavioral Guidelines\n\n"
            "1. NEVER FABRICATE CONTENT. If the source material (transcript, brief, etc.) "
            "does not explicitly state a person's role, a specific date, a metric, or "
            "any factual claim, ASK THE USER to confirm before inserting it. Guessing "
            "names, titles, roles, or data erodes trust in the output.\n\n"
            "2. INSPECT BEFORE YOU EDIT. Before modifying a slide, use inspect_slide (or "
            "get_page) to understand its current element structure. Many slides have "
            "complex visual layouts (Gantt charts, infographics, multi-column designs) "
            "where blindly replacing text produces nonsensical results.\n\n"
            "3. VALIDATE AFTER YOU EDIT. After making changes, use inspect_slide to check "
            "for overflow warnings, empty placeholders, and formatting issues. Fix any "
            "problems before moving to the next slide.\n\n"
            "4. RESPECT EXISTING FORMATTING. When replacing text in styled elements:\n"
            "   - Do NOT insert bullet characters into cells/shapes that already have "
            "paragraph-level bullet formatting.\n"
            "   - Do NOT assume font sizes — inspect the existing formatting first.\n"
            "   - When using batch_update to insert text, also set updateTextStyle "
            "to maintain consistent formatting.\n\n"
            "5. UNDERSTAND SPATIAL RELATIONSHIPS. Elements like Gantt bars, timeline "
            "phases, and infographic connectors are positioned by absolute transforms. "
            "If you change column headers or date ranges, you MUST also reposition "
            "the visual elements to match.\n\n"
            "Authentication is required. Ensure you have valid Google OAuth "
            "credentials configured."
        ),
        auth=auth,
    )

    # Register all tools
    register_all_tools(mcp)
    logger.info("All tools registered")

    # Register all prompts
    register_all_prompts(mcp)
    logger.info("All prompts registered")

    return mcp


def parse_args() -> argparse.Namespace:
    """Parse command line arguments."""
    parser = argparse.ArgumentParser(
        description="Google Slides MCP Server",
        formatter_class=argparse.ArgumentDefaultsHelpFormatter,
    )

    parser.add_argument(
        "--transport",
        choices=["stdio", "streamable-http", "sse"],
        default="stdio",
        help="Transport protocol to use",
    )
    parser.add_argument(
        "--host",
        default="0.0.0.0",
        help="Host to bind to (for HTTP transports)",
    )
    parser.add_argument(
        "--port",
        type=int,
        default=8000,
        help="Port to bind to (for HTTP transports)",
    )
    parser.add_argument(
        "--log-level",
        choices=["DEBUG", "INFO", "WARNING", "ERROR", "CRITICAL"],
        default="INFO",
        help="Logging level",
    )

    return parser.parse_args()


def main() -> None:
    """Main entry point for the server."""
    args = parse_args()

    # Override settings from command line
    settings = get_settings()

    # Apply command line overrides
    if args.transport:
        settings.mcp_transport = args.transport
    if args.host:
        settings.mcp_server_host = args.host
    if args.port:
        settings.mcp_server_port = args.port
    if args.log_level:
        settings.log_level = args.log_level

    # Create and run the app
    mcp = create_app(settings)

    logger.info(f"Starting Google Slides MCP Server with {settings.mcp_transport} transport")

    try:
        if settings.mcp_transport == "stdio":
            mcp.run()
        else:
            mcp.run(
                transport=settings.mcp_transport,
                host=settings.mcp_server_host,
                port=settings.mcp_server_port,
            )
    except KeyboardInterrupt:
        logger.info("Server stopped by user")
        sys.exit(0)
    except Exception as e:
        logger.error(f"Server error: {e}")
        sys.exit(1)


if __name__ == "__main__":
    main()
