"""Tool modules for Google Slides MCP Server.

Each module registers its tools with the FastMCP application.
"""

from google_slides_mcp.tools.analysis import register_analysis_tools
from google_slides_mcp.tools.creation import register_creation_tools
from google_slides_mcp.tools.low_level import register_low_level_tools
from google_slides_mcp.tools.positioning import register_positioning_tools
from google_slides_mcp.tools.templates import register_template_tools
from google_slides_mcp.tools.utility import register_utility_tools


def register_all_tools(mcp) -> None:
    """Register all tools with the MCP application.

    Args:
        mcp: The FastMCP application instance
    """
    register_low_level_tools(mcp)
    register_template_tools(mcp)
    register_positioning_tools(mcp)
    register_creation_tools(mcp)
    register_utility_tools(mcp)
    register_analysis_tools(mcp)


__all__ = [
    "register_all_tools",
    "register_analysis_tools",
    "register_low_level_tools",
    "register_template_tools",
    "register_positioning_tools",
    "register_creation_tools",
    "register_utility_tools",
]
