/**
 * Discovery prompts for Google Slides MCP Server.
 *
 * These prompts help LLMs understand the tool landscape, abstraction levels,
 * and how to navigate the available capabilities effectively.
 */

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

/**
 * Register discovery prompts with the MCP server.
 */
export function registerDiscoveryPrompts(server: McpServer): void {
  /**
   * get_started - Introduction to the tool landscape
   */
  server.registerPrompt(
    "get_started",
    {
      description:
        "Introduction to the Google Slides MCP Server. Explains tool categories, abstraction levels, and the unit system.",
    },
    () => ({
      messages: [
        {
          role: "user" as const,
          content: {
            type: "text" as const,
            text: buildGetStartedContent(),
          },
        },
      ],
    })
  );

  /**
   * tool_reference - Detailed tool reference by category
   */
  server.registerPrompt(
    "tool_reference",
    {
      description:
        "Detailed reference for all available tools, organized by category. Optionally filter to a specific category.",
      argsSchema: {
        category: z
          .enum([
            "templates",
            "content",
            "creation",
            "positioning",
            "utility",
            "analysis",
            "low-level",
          ])
          .optional()
          .describe("Filter to a specific tool category"),
      },
    },
    ({ category }) => ({
      messages: [
        {
          role: "user" as const,
          content: {
            type: "text" as const,
            text: buildToolReferenceContent(category),
          },
        },
      ],
    })
  );

  /**
   * troubleshooting - Common issues and solutions
   */
  server.registerPrompt(
    "troubleshooting",
    {
      description:
        "Common issues and how to resolve them when working with the Google Slides API.",
      argsSchema: {
        issue_type: z
          .enum(["authentication", "permissions", "not_found", "positioning", "content", "general"])
          .optional()
          .describe("Filter to a specific issue type"),
      },
    },
    ({ issue_type }) => ({
      messages: [
        {
          role: "user" as const,
          content: {
            type: "text" as const,
            text: buildTroubleshootingContent(issue_type),
          },
        },
      ],
    })
  );
}

/**
 * Build the get_started prompt content.
 */
function buildGetStartedContent(): string {
  return `# Google Slides MCP Server - Getting Started

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
- \`create_presentation_from_template\` - Template-based deck creation
- \`update_existing_presentation\` - Modify existing presentations
- \`build_presentation_from_scratch\` - Create without templates
- \`analyze_and_replicate_style\` - Extract and apply brand styles

## Quick Start

1. **Find a template**: \`search_presentations(query="quarterly")\`
2. **Copy it**: \`copy_template(template_id, "My Presentation")\`
3. **Analyze structure**: \`analyze_presentation(new_id)\`
4. **Populate content**: \`update_presentation_content(new_id, slides_content)\`
5. **Apply styling**: \`apply_text_style(new_id, "TITLE", font_size=32)\`
`;
}

/**
 * Build the tool_reference prompt content.
 */
function buildToolReferenceContent(
  category?: "templates" | "content" | "creation" | "positioning" | "utility" | "analysis" | "low-level"
): string {
  const sections: Record<string, string> = {
    templates: `## Templates (4 tools)
Starting point for most presentation work.

### search_presentations
Find templates or existing presentations.
\`\`\`
search_presentations(
  query?: string,        // Search by name
  folder_id?: string,    // Limit to folder
  page_size?: number     // Results per page (default 20)
)
\`\`\`
**Returns**: List of presentations with IDs, names, MIME types

### copy_template
Create a working copy of a template.
\`\`\`
copy_template(
  template_id: string,       // Source presentation ID
  new_name: string,          // Name for the copy
  convert_to_slides?: bool   // Convert PPTX to Google Slides
)
\`\`\`
**Returns**: New presentation ID and URL

### replace_placeholders
Replace {{placeholder}} text globally.
\`\`\`
replace_placeholders(
  presentation_id: string,
  replacements: { "{{key}}": "value", ... }
)
\`\`\`
**Returns**: Number of replacements made

### replace_placeholder_with_image
Swap placeholder shapes for images.
\`\`\`
replace_placeholder_with_image(
  presentation_id: string,
  placeholder_text: string,  // Text to find in shapes
  image_url: string          // Image URL to insert
)
\`\`\`
**Returns**: Number of replacements made`,

    content: `## Content (3 tools)
Update text without knowing element IDs.

### update_slide_content
Update a single slide's text by placeholder type.
\`\`\`
update_slide_content(
  presentation_id: string,
  slide_id: string,
  title?: string,      // TITLE placeholder text
  subtitle?: string,   // SUBTITLE placeholder text
  body?: string        // BODY placeholder text
)
\`\`\`
**Note**: Use \`update_presentation_content\` for multiple slides (more efficient).

### update_presentation_content
Bulk update multiple slides in one call.
\`\`\`
update_presentation_content(
  presentation_id: string,
  slides: [
    { slide_id: "...", title: "...", body: "..." },
    { slide_id: "...", title: "...", subtitle: "..." }
  ]
)
\`\`\`
**Why use this**: Single API call for all changes. Much more efficient than calling \`update_slide_content\` multiple times.

### apply_text_style
Apply consistent styling across placeholder types.
\`\`\`
apply_text_style(
  presentation_id: string,
  placeholder_type: "TITLE" | "SUBTITLE" | "BODY",
  font_family?: string,
  font_size?: number,    // In points
  bold?: boolean,
  italic?: boolean,
  color?: string,        // Hex format "#RRGGBB"
  alignment?: "LEFT" | "CENTER" | "RIGHT",
  slide_ids?: string[]   // Limit to specific slides
)
\`\`\``,

    creation: `## Creation (4 tools)
Add new elements. All positions in **inches**.

### create_slide
Add a new slide with a layout template.
\`\`\`
create_slide(
  presentation_id: string,
  layout?: string,           // BLANK, TITLE, TITLE_AND_BODY, etc.
  insertion_index?: number   // Position in slide order
)
\`\`\`
**Layouts**: BLANK, TITLE, TITLE_AND_BODY, TITLE_AND_TWO_COLUMNS, TITLE_ONLY, SECTION_HEADER, MAIN_POINT, BIG_NUMBER

### add_text_box
Add text at a specific position.
\`\`\`
add_text_box(
  presentation_id: string,
  slide_id: string,
  text: string,
  x: number,           // Left edge in inches
  y: number,           // Top edge in inches
  width: number,       // Width in inches
  height: number,      // Height in inches
  font_size?: number,  // Points (default 18)
  font_family?: string,
  bold?: boolean,
  color?: string,      // Hex "#RRGGBB"
  alignment?: string   // LEFT, CENTER, RIGHT
)
\`\`\`

### add_image
Add an image from a URL.
\`\`\`
add_image(
  presentation_id: string,
  slide_id: string,
  image_url: string,
  x: number,
  y: number,
  width: number,
  height: number
)
\`\`\`

### add_shape
Add a geometric shape.
\`\`\`
add_shape(
  presentation_id: string,
  slide_id: string,
  shape_type: string,    // RECTANGLE, ELLIPSE, etc.
  x: number,
  y: number,
  width: number,
  height: number,
  fill_color?: string,   // Hex "#RRGGBB"
  outline_color?: string
)
\`\`\``,

    positioning: `## Positioning (3 tools)
Move and align elements. All measurements in **inches**.

### position_element
Move and/or resize a single element.
\`\`\`
position_element(
  presentation_id: string,
  element_id: string,
  x?: number,           // New left edge
  y?: number,           // New top edge
  width?: number,       // New width
  height?: number,      // New height
  h_align?: string,     // LEFT, CENTER, RIGHT (relative to slide)
  v_align?: string      // TOP, MIDDLE, BOTTOM (relative to slide)
)
\`\`\`
**Note**: Can use absolute coordinates OR alignment OR both.

### align_elements
Align multiple elements to each other or to the slide.
\`\`\`
align_elements(
  presentation_id: string,
  slide_id: string,
  element_ids: string[],
  alignment: "left" | "center" | "right" | "top" | "middle" | "bottom",
  relative_to?: "slide" | "selection"  // Default: selection
)
\`\`\`

### distribute_elements
Space elements evenly.
\`\`\`
distribute_elements(
  presentation_id: string,
  slide_id: string,
  element_ids: string[],
  direction: "horizontal" | "vertical",
  spacing?: number | "even"  // Fixed inches or equal spacing
)
\`\`\``,

    utility: `## Utility (3 tools)
Inspect presentations.

### list_slides
Get an overview of all slides.
\`\`\`
list_slides(presentation_id: string)
\`\`\`
**Returns**: Array of { slide_id, title, element_count }

### get_element_info
Get detailed info about a specific element.
\`\`\`
get_element_info(
  presentation_id: string,
  slide_id: string,
  element_id: string
)
\`\`\`
**Returns**: Position/size in **inches**, element type, text content

### export_thumbnail
Generate a preview image of a slide.
\`\`\`
export_thumbnail(
  presentation_id: string,
  slide_id: string,
  mime_type?: "PNG" | "JPEG"  // Default: PNG
)
\`\`\`
**Returns**: Thumbnail URL (temporary)`,

    analysis: `## Analysis (1 tool)
Deep inspection of presentation structure and styling.

### analyze_presentation
Extract comprehensive style guide and structure.
\`\`\`
analyze_presentation(presentation_id: string)
\`\`\`

**Returns**:
- **Colors**: Primary, secondary, accent, background colors used
- **Fonts**: Font families for headings and body text
- **Slide categories**: Classification of each slide (cover, content, section divider, etc.)
- **Placeholder patterns**: Common placeholder text patterns found
- **Recommendations**: Actionable suggestions for using this template programmatically

**Use cases**:
- Understanding an unfamiliar template before using it
- Extracting a style guide for brand consistency
- Documenting template structure for automation`,

    "low-level": `## Low-Level (3 tools)
Direct API access. Use when semantic tools don't cover your use case.

### get_presentation
Get raw presentation data.
\`\`\`
get_presentation(
  presentation_id: string,
  fields?: string          // Field mask for partial response
)
\`\`\`
**Prefer instead**: \`list_slides\` for overview, \`analyze_presentation\` for structure

### get_page
Get raw slide data.
\`\`\`
get_page(
  presentation_id: string,
  page_id: string
)
\`\`\`
**Prefer instead**: \`get_element_info\` for element details

### batch_update
Execute any Google Slides API request.
\`\`\`
batch_update(
  presentation_id: string,
  requests: [
    { createSlide: { ... } },
    { deleteObject: { objectId: "..." } },
    { updateTextStyle: { ... } },
    ...
  ]
)
\`\`\`

**When to use batch_update**:
- Delete slides or elements (deleteObject)
- Table operations (insertTableRows, deleteTableRow, etc.)
- Animations and transitions
- Group/ungroup elements
- Any of the 47 request types not covered by semantic tools

**API Reference**: https://developers.google.com/slides/api/reference/rest/v1/presentations/batchUpdate`,
  };

  if (category) {
    return `# Tool Reference: ${category.charAt(0).toUpperCase() + category.slice(1)}

${sections[category]}`;
  }

  return `# Google Slides MCP Server - Tool Reference

${sections.templates}

---

${sections.content}

---

${sections.creation}

---

${sections.positioning}

---

${sections.utility}

---

${sections.analysis}

---

${sections["low-level"]}
`;
}

/**
 * Build the troubleshooting prompt content.
 */
function buildTroubleshootingContent(
  issueType?: "authentication" | "permissions" | "not_found" | "positioning" | "content" | "general"
): string {
  const sections: Record<string, string> = {
    authentication: `## Authentication Issues

### "Invalid credentials" or "Token expired"
**Cause**: OAuth access token has expired or is invalid.
**Solution**: Re-authenticate through the MCP client. For Claude Desktop, disconnect and reconnect the server.

### "Insufficient authentication scopes"
**Cause**: Token doesn't have required permissions.
**Solution**: Ensure OAuth includes these scopes:
- \`https://www.googleapis.com/auth/presentations\`
- \`https://www.googleapis.com/auth/drive\`

### "Access denied" for new users
**Cause**: Google OAuth app in testing mode requires test users.
**Solution**: Add user's email to test users in Google Cloud Console > OAuth consent screen.`,

    permissions: `## Permission Issues

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
**Solution**: Use full drive scope for searching existing files.`,

    not_found: `## Not Found Errors

### "Presentation not found"
**Cause**: Invalid presentation ID or no access.
**Solution**:
1. Verify the ID from the URL: \`docs.google.com/presentation/d/{ID}/edit\`
2. Check sharing permissions
3. Ensure the presentation hasn't been deleted

### "Page not found" / "Element not found"
**Cause**: Invalid slide or element ID.
**Solution**:
1. Use \`list_slides\` to get valid slide IDs
2. Use \`get_page\` or \`get_element_info\` to verify element IDs
3. Element IDs can change after certain operations (e.g., copy)

### "Template not found" in copy_template
**Cause**: Template ID is invalid or inaccessible.
**Solution**:
1. Use \`search_presentations\` to find valid templates
2. Verify sharing settings on the template`,

    positioning: `## Positioning Issues

### Elements appear in wrong position
**Cause**: Confusion between inches and EMUs.
**Solution**:
- Semantic tools (\`position_element\`, \`add_text_box\`) use **inches**
- Low-level \`batch_update\` uses **EMUs** (914,400 EMU = 1 inch)
- Standard slide: 10" × 5.625"

### Elements overlap unexpectedly
**Cause**: Not accounting for element size.
**Solution**:
1. Use \`get_element_info\` to check actual dimensions
2. Account for both position (x, y) and size (width, height)
3. Use \`distribute_elements\` for automatic spacing

### Alignment not working
**Cause**: Incorrect element IDs or alignment reference.
**Solution**:
1. Verify element IDs with \`get_page\`
2. Check \`relative_to\` parameter (slide vs selection)
3. Ensure elements are on the same slide`,

    content: `## Content Update Issues

### "Placeholder not found" in update_slide_content
**Cause**: Slide doesn't have the specified placeholder type.
**Solution**:
1. Use \`analyze_presentation\` to see available placeholder types
2. Different layouts have different placeholders
3. BLANK layouts have no placeholders

### Text replacement not working
**Cause**: Placeholder text doesn't match exactly.
**Solution**:
1. Check exact placeholder text (including spaces, case)
2. For \`replace_placeholders\`, use exact {{placeholder}} syntax
3. Use \`get_page\` to see actual text content

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
3. Ensure each slide has the targeted placeholder types`,

    general: `## General Issues

### Rate limiting
**Cause**: Too many API requests too quickly.
**Solution**:
1. Use bulk operations (\`update_presentation_content\`) instead of per-slide calls
2. Add delays between large batch operations
3. Google's quota: 300 requests per minute per user

### Large presentations timeout
**Cause**: Presentation has many slides or elements.
**Solution**:
1. Use field masks with \`get_presentation\` to limit data
2. Process slides in batches
3. Avoid \`analyze_presentation\` on very large decks

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
3. For batch_update, ensure request structure matches API spec`,
  };

  if (issueType) {
    return `# Troubleshooting: ${issueType.charAt(0).toUpperCase() + issueType.slice(1).replace("_", " ")} Issues

${sections[issueType]}`;
  }

  return `# Google Slides MCP Server - Troubleshooting Guide

${sections.authentication}

---

${sections.permissions}

---

${sections.not_found}

---

${sections.positioning}

---

${sections.content}

---

${sections.general}
`;
}
