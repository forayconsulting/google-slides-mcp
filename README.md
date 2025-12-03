# Google Slides MCP Server

A production-ready MCP (Model Context Protocol) server that provides semantic, developer-friendly access to the Google Slides API.

## Features

- **Full API Access**: Direct passthrough to all 47 Google Slides API request types via `batch_update`
- **Semantic Positioning**: Human-friendly tools that abstract away EMU math and transform calculations
- **Template Workflows**: Copy templates, replace placeholders with text or images
- **OAuth 2.1 Support**: Per-request authentication for multi-user scenarios
- **Built with FastMCP**: Clean, maintainable Python code with modern async patterns

## Installation

```bash
pip install google-slides-mcp
```

Or install from source:

```bash
git clone https://github.com/forayconsulting/google-slides-mcp.git
cd google-slides-mcp
pip install -e ".[dev]"
```

## Configuration

### Quick Start

1. Create Google OAuth 2.0 credentials at [Google Cloud Console](https://console.cloud.google.com/apis/credentials)
2. Enable the Google Slides API and Google Drive API
3. Copy `.env.example` to `.env` and fill in your credentials:

```bash
cp .env.example .env
```

Required environment variables:
- `GOOGLE_CLIENT_ID`: Your OAuth 2.0 client ID
- `GOOGLE_CLIENT_SECRET`: Your OAuth 2.0 client secret

### Detailed Setup Guide

For step-by-step instructions with screenshots, see the **[Google OAuth Setup Guide](docs/google-oauth-setup.md)**. This guide covers:

- Creating a Google Cloud project
- Enabling required APIs
- Configuring the OAuth consent screen
- Creating OAuth 2.0 credentials
- Adding test users
- Troubleshooting common issues

## Usage

### Local Development Setup

For local development with stdio transport, you need to acquire OAuth tokens first:

```bash
# 1. Install the package
pip install -e ".[dev]"

# 2. Set up your .env file with GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET

# 3. Run the token acquisition script
python scripts/get_token.py
```

This will open a browser for OAuth consent and save credentials to `~/.google-slides-mcp/credentials.json`.

### Running the Server

```bash
# stdio transport (for Claude Desktop/Claude Code)
google-slides-mcp --transport stdio

# HTTP transport (for remote/multi-user)
google-slides-mcp --transport streamable-http --port 8000
```

### Claude Code Configuration

Add to your project's `.mcp.json` file for project-scoped configuration:

```json
{
  "mcpServers": {
    "google-slides": {
      "type": "stdio",
      "command": "/path/to/your/venv/bin/google-slides-mcp",
      "args": ["--transport", "stdio"],
      "env": {}
    }
  }
}
```

Or use the CLI to add it:

```bash
claude mcp add google-slides --scope project -- /path/to/venv/bin/google-slides-mcp --transport stdio
```

### Claude Desktop Configuration

Add to your Claude Desktop config (`~/Library/Application Support/Claude/claude_desktop_config.json`):

```json
{
  "mcpServers": {
    "google-slides": {
      "command": "google-slides-mcp",
      "args": ["--transport", "stdio"],
      "env": {
        "GOOGLE_CLIENT_ID": "your-client-id",
        "GOOGLE_CLIENT_SECRET": "your-client-secret"
      }
    }
  }
}
```

## Available Tools

### Low-Level Tools
- `batch_update` - Execute raw batchUpdate requests against Google Slides API
- `get_presentation` - Retrieve presentation metadata, slides, and elements
- `get_page` - Get detailed information about a specific slide

### Template Tools
- `copy_template` - Copy a Google Slides template to create a new presentation
- `replace_placeholders` - Replace placeholder text throughout a presentation
- `replace_placeholder_with_image` - Replace placeholder shapes with images

### Positioning Tools
- `position_element` - Position and size elements using inches and alignment
- `distribute_elements` - Distribute elements evenly across the slide
- `align_elements` - Align multiple elements to each other or the slide

### Creation Tools
- `create_slide` - Create a new slide with a specified layout
- `add_text_box` - Add a styled text box to a slide
- `add_image` - Add an image from a URL
- `add_shape` - Add shapes (rectangle, ellipse, etc.)

### Utility Tools
- `list_slides` - List all slides with IDs and titles
- `get_element_info` - Get element details in human-readable format
- `export_thumbnail` - Generate slide thumbnails

## Development

```bash
# Install dev dependencies
pip install -e ".[dev]"

# Run tests
pytest

# Run linting
ruff check .

# Run type checking
mypy src/
```

## Development History

For a detailed chronology of how this project was conceived and built—from initial ideation to working implementation—see [development_history.md](development_history.md).

## License

MIT License - see [LICENSE](LICENSE) for details.
