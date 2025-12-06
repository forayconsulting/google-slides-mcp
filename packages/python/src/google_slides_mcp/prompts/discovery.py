"""Discovery prompts for Google Slides MCP Server.

These prompts help LLMs understand the tool landscape, abstraction levels,
and how to navigate the available capabilities effectively.
"""

from typing import Literal


def register_discovery_prompts(mcp) -> None:
    """Register discovery prompts with the MCP application.

    Args:
        mcp: The FastMCP application instance
    """

    @mcp.prompt()
    def get_started() -> str:
        """Introduction to the Google Slides MCP Server.

        Explains tool categories, abstraction levels, and the unit system.
        """
        return _build_get_started_content()

    @mcp.prompt()
    def tool_reference(
        category: Literal[
            "templates",
            "content",
            "creation",
            "positioning",
            "utility",
            "analysis",
            "low-level",
        ]
        | None = None,
    ) -> str:
        """Detailed reference for all available tools, organized by category.

        Optionally filter to a specific category.
        """
        return _build_tool_reference_content(category)

    @mcp.prompt()
    def troubleshooting(
        issue_type: Literal[
            "authentication",
            "permissions",
            "not_found",
            "positioning",
            "content",
            "general",
        ]
        | None = None,
    ) -> str:
        """Common issues and how to resolve them when working with the Google Slides API."""
        return _build_troubleshooting_content(issue_type)


def _build_get_started_content() -> str:
    """Build the get_started prompt content."""
    return """# Google Slides MCP Server - Getting Started

This server provides **21 tools** for creating and manipulating Google Slides presentations, organized into a hierarchy from high-level semantic operations to low-level API access.

## Abstraction Levels

### Level 1: Semantic Tools (Recommended - 90% of use cases)
Work with presentations using intuitive concepts. These tools handle complexity internally:

| Category | Tools | What They Abstract |
|----------|-------|-------------------|
| **Templates** | copy_template, replace_placeholders, replace_placeholder_with_image, search_presentations | File operations, text replacement |
| **Content** | update_slide_content, update_presentation_content, apply_text_style | Element ID discovery, batch operations |
| **Positioning** | position_element, align_elements, distribute_elements | EMU math, transform matrices |

### Level 2: Creation Tools
Create new elements with sensible defaults:

| Tool | Purpose |
|------|---------|
| create_slide | Add slides with layout templates |
| add_text_box | Add text at specific position |
| add_image | Add images from URLs |
| add_shape | Add geometric shapes |

All positions and sizes use **inches** (not EMUs).

### Level 3: Utility Tools
Inspect and understand presentations:

| Tool | Purpose |
|------|---------|
| list_slides | Get slide IDs and titles |
| get_element_info | Get element position/size in inches |
| export_thumbnail | Generate slide preview images |
| analyze_presentation | Comprehensive style/structure analysis |

### Level 4: Low-Level API (Advanced)
Direct Google Slides API access for cases not covered by semantic tools:

| Tool | Purpose |
|------|---------|
| get_presentation | Raw presentation data |
| get_page | Raw slide data |
| batch_update | Full API control (47 request types) |

**When to use low-level tools:**
- Deleting slides or elements
- Table operations
- Animations and transitions
- Custom formatting not supported by semantic tools

## Unit System

| Context | Unit | Notes |
|---------|------|-------|
| Semantic tools | **Inches** | Human-friendly, converted internally |
| Low-level tools | **EMU** | 914,400 EMU = 1 inch |
| Standard slide | 10" × 5.625" | 16:9 aspect ratio |

## Common Workflows

Use these prompts for guided workflows:
- `create_presentation_from_template` - Template-based deck creation
- `update_existing_presentation` - Modify existing presentations
- `build_presentation_from_scratch` - Create without templates
- `analyze_and_replicate_style` - Extract and apply brand styles

## Quick Start

1. **Find a template**: `search_presentations(query="quarterly")`
2. **Copy it**: `copy_template(template_id, "My Presentation")`
3. **Analyze structure**: `analyze_presentation(new_id)`
4. **Populate content**: `update_presentation_content(new_id, slides_content)`
5. **Apply styling**: `apply_text_style(new_id, "TITLE", font_size=32)`
"""


def _build_tool_reference_content(
    category: str | None,
) -> str:
    """Build the tool_reference prompt content."""
    sections = {
        "templates": """## Templates (4 tools)
Starting point for most presentation work.

### search_presentations
Find templates or existing presentations.
```
search_presentations(
  query: str | None = None,   # Search by name
  folder_id: str | None = None,  # Limit to folder
  page_size: int = 20         # Results per page
)
```
**Returns**: List of presentations with IDs, names, MIME types

### copy_template
Create a working copy of a template.
```
copy_template(
  template_id: str,           # Source presentation ID
  new_name: str,              # Name for the copy
  convert_to_slides: bool = False  # Convert PPTX to Google Slides
)
```
**Returns**: New presentation ID and URL

### replace_placeholders
Replace {{placeholder}} text globally.
```
replace_placeholders(
  presentation_id: str,
  replacements: dict[str, str]  # {"{{key}}": "value", ...}
)
```
**Returns**: Number of replacements made

### replace_placeholder_with_image
Swap placeholder shapes for images.
```
replace_placeholder_with_image(
  presentation_id: str,
  placeholder_text: str,  # Text to find in shapes
  image_url: str          # Image URL to insert
)
```
**Returns**: Number of replacements made""",
        "content": """## Content (3 tools)
Update text without knowing element IDs.

### update_slide_content
Update a single slide's text by placeholder type.
```
update_slide_content(
  presentation_id: str,
  slide_id: str,
  title: str | None = None,      # TITLE placeholder text
  subtitle: str | None = None,   # SUBTITLE placeholder text
  body: str | None = None        # BODY placeholder text
)
```
**Note**: Use `update_presentation_content` for multiple slides (more efficient).

### update_presentation_content
Bulk update multiple slides in one call.
```
update_presentation_content(
  presentation_id: str,
  slides: list[dict]  # [{"slide_id": "...", "title": "...", "body": "..."}]
)
```
**Why use this**: Single API call for all changes. Much more efficient than calling `update_slide_content` multiple times.

### apply_text_style
Apply consistent styling across placeholder types.
```
apply_text_style(
  presentation_id: str,
  placeholder_type: Literal["TITLE", "SUBTITLE", "BODY"],
  font_family: str | None = None,
  font_size: int | None = None,    # In points
  bold: bool | None = None,
  italic: bool | None = None,
  color: str | None = None,        # Hex format "#RRGGBB"
  alignment: Literal["LEFT", "CENTER", "RIGHT"] | None = None,
  slide_ids: list[str] | None = None  # Limit to specific slides
)
```""",
        "creation": """## Creation (4 tools)
Add new elements. All positions in **inches**.

### create_slide
Add a new slide with a layout template.
```
create_slide(
  presentation_id: str,
  layout: str = "BLANK",         # BLANK, TITLE, TITLE_AND_BODY, etc.
  insertion_index: int | None = None  # Position in slide order
)
```
**Layouts**: BLANK, TITLE, TITLE_AND_BODY, TITLE_AND_TWO_COLUMNS, TITLE_ONLY, SECTION_HEADER, MAIN_POINT, BIG_NUMBER

### add_text_box
Add text at a specific position.
```
add_text_box(
  presentation_id: str,
  slide_id: str,
  text: str,
  x: float,           # Left edge in inches
  y: float,           # Top edge in inches
  width: float,       # Width in inches
  height: float,      # Height in inches
  font_size: int = 18,
  font_family: str | None = None,
  bold: bool = False,
  color: str | None = None,      # Hex "#RRGGBB"
  alignment: str = "LEFT"        # LEFT, CENTER, RIGHT
)
```

### add_image
Add an image from a URL.
```
add_image(
  presentation_id: str,
  slide_id: str,
  image_url: str,
  x: float,
  y: float,
  width: float,
  height: float
)
```

### add_shape
Add a geometric shape.
```
add_shape(
  presentation_id: str,
  slide_id: str,
  shape_type: str,    # RECTANGLE, ELLIPSE, etc.
  x: float,
  y: float,
  width: float,
  height: float,
  fill_color: str | None = None,   # Hex "#RRGGBB"
  outline_color: str | None = None
)
```""",
        "positioning": """## Positioning (3 tools)
Move and align elements. All measurements in **inches**.

### position_element
Move and/or resize a single element.
```
position_element(
  presentation_id: str,
  element_id: str,
  x: float | None = None,           # New left edge
  y: float | None = None,           # New top edge
  width: float | None = None,       # New width
  height: float | None = None,      # New height
  h_align: str | None = None,       # LEFT, CENTER, RIGHT (relative to slide)
  v_align: str | None = None        # TOP, MIDDLE, BOTTOM (relative to slide)
)
```
**Note**: Can use absolute coordinates OR alignment OR both.

### align_elements
Align multiple elements to each other or to the slide.
```
align_elements(
  presentation_id: str,
  slide_id: str,
  element_ids: list[str],
  alignment: Literal["left", "center", "right", "top", "middle", "bottom"],
  relative_to: Literal["slide", "selection"] = "selection"
)
```

### distribute_elements
Space elements evenly.
```
distribute_elements(
  presentation_id: str,
  slide_id: str,
  element_ids: list[str],
  direction: Literal["horizontal", "vertical"],
  spacing: float | Literal["even"] | None = "even"  # Fixed inches or equal spacing
)
```""",
        "utility": """## Utility (3 tools)
Inspect presentations.

### list_slides
Get an overview of all slides.
```
list_slides(presentation_id: str)
```
**Returns**: List of dicts with slide_id, title, element_count

### get_element_info
Get detailed info about a specific element.
```
get_element_info(
  presentation_id: str,
  slide_id: str,
  element_id: str
)
```
**Returns**: Position/size in **inches**, element type, text content

### export_thumbnail
Generate a preview image of a slide.
```
export_thumbnail(
  presentation_id: str,
  slide_id: str,
  mime_type: Literal["PNG", "JPEG"] = "PNG"
)
```
**Returns**: Thumbnail URL (temporary)""",
        "analysis": """## Analysis (1 tool)
Deep inspection of presentation structure and styling.

### analyze_presentation
Extract comprehensive style guide and structure.
```
analyze_presentation(presentation_id: str)
```

**Returns**:
- **Colors**: Primary, secondary, accent, background colors used
- **Fonts**: Font families for headings and body text
- **Slide categories**: Classification of each slide (cover, content, section divider, etc.)
- **Placeholder patterns**: Common placeholder text patterns found
- **Recommendations**: Actionable suggestions for using this template programmatically

**Use cases**:
- Understanding an unfamiliar template before using it
- Extracting a style guide for brand consistency
- Documenting template structure for automation""",
        "low-level": """## Low-Level (3 tools)
Direct API access. Use when semantic tools don't cover your use case.

### get_presentation
Get raw presentation data.
```
get_presentation(
  presentation_id: str,
  fields: str | None = None  # Field mask for partial response
)
```
**Prefer instead**: `list_slides` for overview, `analyze_presentation` for structure

### get_page
Get raw slide data.
```
get_page(
  presentation_id: str,
  page_id: str
)
```
**Prefer instead**: `get_element_info` for element details

### batch_update
Execute any Google Slides API request.
```
batch_update(
  presentation_id: str,
  requests: list[dict]  # [{"createSlide": {...}}, {"deleteObject": {...}}, ...]
)
```

**When to use batch_update**:
- Delete slides or elements (deleteObject)
- Table operations (insertTableRows, deleteTableRow, etc.)
- Animations and transitions
- Group/ungroup elements
- Any of the 47 request types not covered by semantic tools

**API Reference**: https://developers.google.com/slides/api/reference/rest/v1/presentations/batchUpdate""",
    }

    if category:
        return f"""# Tool Reference: {category.replace("-", " ").title()}

{sections[category]}"""

    return f"""# Google Slides MCP Server - Tool Reference

{sections["templates"]}

---

{sections["content"]}

---

{sections["creation"]}

---

{sections["positioning"]}

---

{sections["utility"]}

---

{sections["analysis"]}

---

{sections["low-level"]}
"""


def _build_troubleshooting_content(
    issue_type: str | None,
) -> str:
    """Build the troubleshooting prompt content."""
    sections = {
        "authentication": """## Authentication Issues

### "Invalid credentials" or "Token expired"
**Cause**: OAuth access token has expired or is invalid.
**Solution**: Re-authenticate through the MCP client. For Claude Desktop, disconnect and reconnect the server.

### "Insufficient authentication scopes"
**Cause**: Token doesn't have required permissions.
**Solution**: Ensure OAuth includes these scopes:
- `https://www.googleapis.com/auth/presentations`
- `https://www.googleapis.com/auth/drive`

### "Access denied" for new users
**Cause**: Google OAuth app in testing mode requires test users.
**Solution**: Add user's email to test users in Google Cloud Console > OAuth consent screen.""",
        "permissions": """## Permission Issues

### "The caller does not have permission"
**Cause**: User doesn't have access to the presentation.
**Solution**:
1. Check the presentation is shared with the user
2. Verify the presentation ID is correct
3. For Drive operations, ensure drive scope is included

### "Cannot edit presentation"
**Cause**: User has view-only access.
**Solution**: Request edit access from the presentation owner.

### "search_presentations returns empty"
**Cause**: Using drive.file scope (only sees files created by app).
**Solution**: Use full drive scope for searching existing files.""",
        "not_found": """## Not Found Errors

### "Presentation not found"
**Cause**: Invalid presentation ID or no access.
**Solution**:
1. Verify the ID from the URL: `docs.google.com/presentation/d/{ID}/edit`
2. Check sharing permissions
3. Ensure the presentation hasn't been deleted

### "Page not found" / "Element not found"
**Cause**: Invalid slide or element ID.
**Solution**:
1. Use `list_slides` to get valid slide IDs
2. Use `get_page` or `get_element_info` to verify element IDs
3. Element IDs can change after certain operations (e.g., copy)

### "Template not found" in copy_template
**Cause**: Template ID is invalid or inaccessible.
**Solution**:
1. Use `search_presentations` to find valid templates
2. Verify sharing settings on the template""",
        "positioning": """## Positioning Issues

### Elements appear in wrong position
**Cause**: Confusion between inches and EMUs.
**Solution**:
- Semantic tools (`position_element`, `add_text_box`) use **inches**
- Low-level `batch_update` uses **EMUs** (914,400 EMU = 1 inch)
- Standard slide: 10" × 5.625"

### Elements overlap unexpectedly
**Cause**: Not accounting for element size.
**Solution**:
1. Use `get_element_info` to check actual dimensions
2. Account for both position (x, y) and size (width, height)
3. Use `distribute_elements` for automatic spacing

### Alignment not working
**Cause**: Incorrect element IDs or alignment reference.
**Solution**:
1. Verify element IDs with `get_page`
2. Check `relative_to` parameter (slide vs selection)
3. Ensure elements are on the same slide""",
        "content": """## Content Update Issues

### "Placeholder not found" in update_slide_content
**Cause**: Slide doesn't have the specified placeholder type.
**Solution**:
1. Use `analyze_presentation` to see available placeholder types
2. Different layouts have different placeholders
3. BLANK layouts have no placeholders

### Text replacement not working
**Cause**: Placeholder text doesn't match exactly.
**Solution**:
1. Check exact placeholder text (including spaces, case)
2. For `replace_placeholders`, use exact {{placeholder}} syntax
3. Use `get_page` to see actual text content

### Styling not applied
**Cause**: Targeting wrong placeholder type or slides.
**Solution**:
1. Verify placeholder_type matches (TITLE, SUBTITLE, BODY)
2. If using slide_ids filter, ensure IDs are correct
3. Some text may not be in placeholders (use batch_update instead)

### Bulk update partially fails
**Cause**: One slide in the batch has issues.
**Solution**:
1. Check which slides failed in the response
2. Verify each slide_id exists
3. Ensure each slide has the targeted placeholder types""",
        "general": """## General Issues

### Rate limiting
**Cause**: Too many API requests too quickly.
**Solution**:
1. Use bulk operations (`update_presentation_content`) instead of per-slide calls
2. Add delays between large batch operations
3. Google's quota: 300 requests per minute per user

### Large presentations timeout
**Cause**: Presentation has many slides or elements.
**Solution**:
1. Use field masks with `get_presentation` to limit data
2. Process slides in batches
3. Avoid `analyze_presentation` on very large decks

### Changes not visible
**Cause**: Browser cache or viewing old version.
**Solution**:
1. Refresh the presentation in Google Slides
2. Check if changes were actually made (no error returned)
3. Verify correct presentation ID

### "Invalid request" errors
**Cause**: Malformed API request.
**Solution**:
1. Check parameter types (strings vs numbers)
2. Verify required parameters are provided
3. For batch_update, ensure request structure matches API spec""",
    }

    if issue_type:
        return f"""# Troubleshooting: {issue_type.replace("_", " ").title()} Issues

{sections[issue_type]}"""

    return f"""# Google Slides MCP Server - Troubleshooting Guide

{sections["authentication"]}

---

{sections["permissions"]}

---

{sections["not_found"]}

---

{sections["positioning"]}

---

{sections["content"]}

---

{sections["general"]}
"""
