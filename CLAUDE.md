# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Repository Structure

This is a **monorepo** with two implementations of the Google Slides MCP server:

```
google-slides-mcp/
├── packages/
│   ├── python/          # FastMCP 2.x implementation (local stdio)
│   └── cloudflare/      # Cloudflare Workers implementation (remote SSE)
├── docs/                # Shared documentation
└── README.md
```

## Cloudflare Workers Package (Primary)

### Build and Development Commands

```bash
cd packages/cloudflare

# Install dependencies
npm install

# Local development
npm run dev

# Type checking
npm run typecheck

# Deploy to Cloudflare
npm run deploy
```

### Architecture

- **OAuthProvider** (`src/index.ts`): Entry point handling MCP OAuth 2.1 with PKCE
- **McpAgent** (`src/mcp-agent.ts`): Durable Object maintaining session state and WebSocket connections
- **Google OAuth Handler** (`src/auth/`): Upstream authentication with Google
- **Tools** (`src/tools/`): 21 MCP tools organized by functionality
- **API Clients** (`src/api/`): Direct REST clients for Google Slides and Drive APIs
- **Utilities** (`src/utils/`): EMU conversion, color parsing, transform matrices

### Tool Organization

Tools are organized by functionality in `src/tools/`:

- **low-level.ts**: Direct API access (`batch_update`, `get_presentation`, `get_page`)
- **creation.ts**: Element creation (`create_slide`, `add_text_box`, `add_image`, `add_shape`)
- **positioning.ts**: Semantic positioning (`position_element`, `align_elements`, `distribute_elements`)
- **templates.ts**: Template operations (`copy_template`, `replace_placeholders`, `replace_placeholder_with_image`, `search_presentations`)
- **utility.ts**: Inspection tools (`list_slides`, `get_element_info`, `export_thumbnail`)
- **content.ts**: Semantic updates (`update_slide_content`, `update_presentation_content`, `apply_text_style`)
- **analysis.ts**: Style extraction (`analyze_presentation`)

Each module exports a `register*Tools(server, props)` function called from `tools/index.ts`.

### EMU Unit System

Google Slides API uses English Metric Units (EMU) for all positioning. Key constants:
- 914,400 EMU = 1 inch
- Standard slide: 10" × 5.625" (16:9)

The `utils/units.ts` provides conversions. **All semantic tools accept inches** and convert internally.

## Python Package (Local Use)

### Build and Development Commands

```bash
cd packages/python

# Install for development
pip install -e ".[dev]"

# Run the MCP server (stdio transport)
google-slides-mcp --transport stdio

# Run tests
pytest

# Linting
ruff check .

# Type checking
mypy src/

# Acquire OAuth tokens for local development
python scripts/get_token.py
```

### Architecture

This is a **FastMCP 2.x** server. The entry point is `src/google_slides_mcp/server.py`.

Two authentication modes:
1. **OAuth 2.1 (HTTP transport)**: Per-request authentication via FastMCP auth providers
2. **Stored Credentials (stdio transport)**: Loads tokens from `~/.google-slides-mcp/credentials.json`

### Tool Function Signature Pattern

```python
@mcp.tool()
async def tool_name(
    ctx: Context,           # MUST be first (FastMCP injects this)
    required_param: str,    # Required params next
    optional_param: str = "default",  # Optional params last
) -> dict:
```

**Critical**: `ctx: Context` must be the first parameter and must use the direct import `from fastmcp import Context` (not a string annotation).
