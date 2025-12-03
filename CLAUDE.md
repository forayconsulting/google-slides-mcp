# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Build and Development Commands

```bash
# Install for development
pip install -e ".[dev]"

# Run the MCP server (stdio transport)
google-slides-mcp --transport stdio

# Run the MCP server (HTTP transport)
google-slides-mcp --transport streamable-http --port 8000

# Run tests
pytest

# Run a single test file
pytest tests/test_file.py

# Run a specific test
pytest tests/test_file.py::test_function_name

# Linting
ruff check .
ruff check --fix .

# Type checking
mypy src/

# Acquire OAuth tokens for local development
python scripts/get_token.py
```

## Architecture

### MCP Server Framework

This is a **FastMCP 2.x** server providing Google Slides API access via the Model Context Protocol. The entry point is `server.py` which creates the FastMCP application and registers all tools.

### Authentication Flow

Two authentication modes are supported:

1. **OAuth 2.1 (HTTP transport)**: Per-request authentication via FastMCP's auth providers. Credentials extracted from MCP context.

2. **Stored Credentials (stdio transport)**: Loads pre-authorized tokens from `~/.google-slides-mcp/credentials.json`. Use `scripts/get_token.py` to perform initial OAuth consent flow.

The `auth/middleware.py` handles both modes transparently - tools call `middleware.extract_credentials(ctx)` and get valid credentials regardless of transport.

### Tool Organization

Tools are organized by functionality in `src/google_slides_mcp/tools/`:

- **low_level.py**: Direct API access (`batch_update`, `get_presentation`, `get_page`)
- **creation.py**: Element creation (`create_slide`, `add_text_box`, `add_image`, `add_shape`)
- **positioning.py**: Semantic positioning (`position_element`, `align_elements`, `distribute_elements`)
- **templates.py**: Template operations (`copy_template`, `replace_placeholders`)
- **utility.py**: Inspection tools (`list_slides`, `get_element_info`, `export_thumbnail`)

Each module exports a `register_*_tools(mcp)` function called from `tools/__init__.py`.

### EMU Unit System

Google Slides API uses English Metric Units (EMU) for all positioning. Key constants:
- 914,400 EMU = 1 inch
- Standard slide: 10" × 5.625" (16:9)

The `utils/units.py` provides conversions. The `utils/transforms.py` provides transform matrix helpers. **All semantic tools accept inches** and convert internally.

### Tool Function Signature Pattern

All tools follow this pattern:
```python
@mcp.tool()
async def tool_name(
    ctx: Context,           # MUST be first (FastMCP injects this)
    required_param: str,    # Required params next
    optional_param: str = "default",  # Optional params last
) -> dict:
```

**Critical**: `ctx: Context` must be the first parameter and must use the direct import `from fastmcp import Context` (not a string annotation) for Pydantic TypeAdapter compatibility.

### Service Layer

`services/slides_service.py` and `services/drive_service.py` wrap the Google API client libraries with async-friendly methods. Tools instantiate services with credentials from middleware.
