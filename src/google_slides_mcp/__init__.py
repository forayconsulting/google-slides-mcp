"""Google Slides MCP Server.

A production-ready MCP server providing semantic, developer-friendly
access to the Google Slides API.
"""

__version__ = "0.1.0"

from google_slides_mcp.server import create_app, main

__all__ = ["__version__", "create_app", "main"]
