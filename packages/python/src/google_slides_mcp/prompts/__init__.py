"""Prompt modules for Google Slides MCP Server.

Prompts provide semantic routing guidance to help LLMs use tools optimally.
Each module registers its prompts with the FastMCP application.
"""

from google_slides_mcp.prompts.discovery import register_discovery_prompts
from google_slides_mcp.prompts.workflows import register_workflow_prompts


def register_all_prompts(mcp) -> None:
    """Register all prompts with the MCP application.

    Args:
        mcp: The FastMCP application instance
    """
    # Workflow prompts (4 prompts)
    # - create_presentation_from_template
    # - update_existing_presentation
    # - build_presentation_from_scratch
    # - analyze_and_replicate_style
    register_workflow_prompts(mcp)

    # Discovery prompts (3 prompts)
    # - get_started
    # - tool_reference
    # - troubleshooting
    register_discovery_prompts(mcp)

    # Total: 7 prompts


__all__ = [
    "register_all_prompts",
    "register_workflow_prompts",
    "register_discovery_prompts",
]
