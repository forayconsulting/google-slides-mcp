/**
 * Workflow prompts for Google Slides MCP Server.
 *
 * These prompts guide LLMs through multi-step presentation workflows,
 * helping them use tools in the optimal order and at the right abstraction level.
 */

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

/**
 * Register workflow prompts with the MCP server.
 */
export function registerWorkflowPrompts(server: McpServer): void {
  /**
   * create_presentation_from_template - Complete template-based deck creation workflow
   */
  server.registerPrompt(
    "create_presentation_from_template",
    {
      description:
        "Step-by-step workflow for creating presentations from templates. Guides through template selection, copying, analysis, content population, and styling.",
      argsSchema: {
        template_id: z
          .string()
          .optional()
          .describe("Optional template presentation ID. If not provided, workflow starts with template search."),
        presentation_name: z
          .string()
          .describe("Name for the new presentation"),
      },
    },
    ({ template_id, presentation_name }) => ({
      messages: [
        {
          role: "user" as const,
          content: {
            type: "text" as const,
            text: buildTemplateWorkflow(template_id, presentation_name),
          },
        },
      ],
    })
  );

  /**
   * update_existing_presentation - Guide for modifying an existing presentation
   */
  server.registerPrompt(
    "update_existing_presentation",
    {
      description:
        "Workflow for modifying an existing presentation. Covers content updates, styling changes, and element repositioning.",
      argsSchema: {
        presentation_id: z
          .string()
          .describe("The ID of the presentation to modify"),
        task_description: z
          .string()
          .describe("Description of what changes to make"),
      },
    },
    ({ presentation_id, task_description }) => ({
      messages: [
        {
          role: "user" as const,
          content: {
            type: "text" as const,
            text: buildUpdateWorkflow(presentation_id, task_description),
          },
        },
      ],
    })
  );

  /**
   * build_presentation_from_scratch - Workflow for creating without templates
   */
  server.registerPrompt(
    "build_presentation_from_scratch",
    {
      description:
        "Workflow for creating a presentation from scratch without using templates. Covers slide creation, element addition, positioning, and styling.",
      argsSchema: {
        title: z.string().describe("Title for the presentation"),
        slide_count: z
          .number()
          .optional()
          .describe("Approximate number of slides needed"),
      },
    },
    ({ title, slide_count }) => ({
      messages: [
        {
          role: "user" as const,
          content: {
            type: "text" as const,
            text: buildFromScratchWorkflow(title, slide_count),
          },
        },
      ],
    })
  );

  /**
   * analyze_and_replicate_style - Extract and apply style guide
   */
  server.registerPrompt(
    "analyze_and_replicate_style",
    {
      description:
        "Workflow for extracting a style guide from one presentation and applying it to another. Useful for brand consistency.",
      argsSchema: {
        source_id: z
          .string()
          .describe("The presentation ID to extract styles from"),
        target_id: z
          .string()
          .describe("The presentation ID to apply styles to"),
      },
    },
    ({ source_id, target_id }) => ({
      messages: [
        {
          role: "user" as const,
          content: {
            type: "text" as const,
            text: buildStyleReplicationWorkflow(source_id, target_id),
          },
        },
      ],
    })
  );
}

/**
 * Build the template-based workflow prompt content.
 */
function buildTemplateWorkflow(
  templateId: string | undefined,
  presentationName: string
): string {
  const hasTemplate = templateId !== undefined && templateId !== "";

  return `# Template-Based Presentation Creation Workflow

Creating presentation: **${presentationName}**
${hasTemplate ? `Using template: \`${templateId}\`` : "Template: Not specified (will search)"}

## Step 1: ${hasTemplate ? "Skip - Template Provided" : "Find a Template"}
${
  hasTemplate
    ? `Template ID \`${templateId}\` provided. Proceed to Step 2.`
    : `Use \`search_presentations\` to find templates:
- Search by name: \`search_presentations(query="quarterly report")\`
- Browse a folder: \`search_presentations(folder_id="...")\`
- Filter by type: Results include both Google Slides and PowerPoint files`
}

## Step 2: Analyze the Template (Recommended)
Before copying, understand the template structure:
- Use \`analyze_presentation(presentation_id="${hasTemplate ? templateId : "<template_id>"}")\`
- Review the output for:
  - **Slide categories**: cover, section divider, content, mockup, etc.
  - **Placeholder patterns**: e.g., "{{company_name}}", "Full Name //"
  - **Color scheme**: Primary, secondary, accent colors
  - **Font families**: Heading and body fonts

## Step 3: Copy the Template
Create your working copy:
- For Google Slides: \`copy_template(template_id="${hasTemplate ? templateId : "<template_id>"}", new_name="${presentationName}")\`
- For PowerPoint (.pptx): Add \`convert_to_slides=true\` to convert to native Google Slides

## Step 4: Populate Content
Choose the right tool based on your content type:

| Content Type | Tool | Example |
|--------------|------|---------|
| {{placeholder}} text | \`replace_placeholders\` | \`replace_placeholders(id, {"{{company}}": "Acme Corp"})\` |
| TITLE/SUBTITLE/BODY | \`update_presentation_content\` | Bulk update by placeholder type |
| Single slide text | \`update_slide_content\` | Update one slide's placeholders |
| Image placeholders | \`replace_placeholder_with_image\` | Swap shapes for images |

**Recommendation**: For multiple slides, use \`update_presentation_content\` - it's more efficient (single API call).

## Step 5: Apply Styling (Optional)
If the template styling needs adjustment:
- Use \`apply_text_style\` to modify fonts, sizes, colors by placeholder type
- This applies consistently across all matching elements

## Tool Abstraction Guide

| Abstraction Level | When to Use |
|-------------------|-------------|
| **Semantic tools** (90% of cases) | Template operations, content updates, positioning |
| **Low-level \`batch_update\`** | Delete slides, animations, tables, advanced customization |

The semantic tools handle EMU conversion and element ID discovery automatically.
`;
}

/**
 * Build the update workflow prompt content.
 */
function buildUpdateWorkflow(
  presentationId: string,
  taskDescription: string
): string {
  return `# Presentation Update Workflow

Modifying presentation: \`${presentationId}\`
Task: ${taskDescription}

## Step 1: Understand Current State
Start by inspecting the presentation:
- \`list_slides(presentation_id="${presentationId}")\` - Get slide overview
- \`analyze_presentation(presentation_id="${presentationId}")\` - Deep structure analysis

## Step 2: Choose Your Approach

### For Text Content Updates
| Task | Tool | Notes |
|------|------|-------|
| Update titles/subtitles/body | \`update_slide_content\` | By placeholder type, no IDs needed |
| Bulk update multiple slides | \`update_presentation_content\` | Single API call, most efficient |
| Find/replace text globally | \`replace_placeholders\` | Works with {{placeholder}} patterns |

### For Styling Changes
| Task | Tool | Notes |
|------|------|-------|
| Change fonts/colors/sizes | \`apply_text_style\` | By placeholder type across slides |
| Advanced formatting | \`batch_update\` | Full API access for complex styles |

### For Layout/Positioning
| Task | Tool | Notes |
|------|------|-------|
| Move/resize elements | \`position_element\` | Uses inches, not EMUs |
| Align multiple elements | \`align_elements\` | Align to edge or to each other |
| Space elements evenly | \`distribute_elements\` | Horizontal or vertical distribution |

### For Structural Changes
| Task | Tool | Notes |
|------|------|-------|
| Add new slides | \`create_slide\` | With layout templates |
| Add text boxes | \`add_text_box\` | New text at specific position |
| Add images | \`add_image\` | From URL |
| Delete slides/elements | \`batch_update\` | Use deleteObject request |

## Step 3: Execute Changes
Based on your task, use the appropriate tools from Step 2.

## Step 4: Verify Results
- Use \`list_slides\` to confirm slide structure
- Use \`get_element_info\` to verify element positions
- Use \`export_thumbnail\` to preview specific slides

## Important Notes
- All positioning tools use **inches** (not EMUs)
- Standard slide size: 10" × 5.625" (16:9)
- Content tools find elements by placeholder type - no element IDs needed
`;
}

/**
 * Build the from-scratch workflow prompt content.
 */
function buildFromScratchWorkflow(
  title: string,
  slideCount: number | undefined
): string {
  const count = slideCount ?? "several";

  return `# Build Presentation From Scratch

Creating: **${title}**
Estimated slides: ${count}

## Step 1: Create the Presentation
First, create a blank presentation:
- Use \`batch_update\` with a \`create\` operation, or
- Copy a minimal template: \`copy_template(template_id="<blank_template>", new_name="${title}")\`

## Step 2: Plan Your Slide Structure
Common slide types:
1. **Title slide** - Opening with title and subtitle
2. **Section dividers** - Transition between topics
3. **Content slides** - Main information
4. **Closing slide** - Summary or call-to-action

## Step 3: Create Slides
For each slide:
\`\`\`
create_slide(
  presentation_id="<id>",
  layout="BLANK"  // or TITLE, TITLE_AND_BODY, etc.
)
\`\`\`

Available layouts: BLANK, TITLE, TITLE_AND_BODY, TITLE_AND_TWO_COLUMNS, TITLE_ONLY, SECTION_HEADER, etc.

## Step 4: Add Content Elements
| Element | Tool | Key Parameters |
|---------|------|----------------|
| Text | \`add_text_box\` | x, y, width, height (in inches), text, font_size |
| Images | \`add_image\` | x, y, width, height, image_url |
| Shapes | \`add_shape\` | shape_type, position, fill_color |

### Positioning Reference (16:9 slide = 10" × 5.625")
| Position | X (inches) | Y (inches) |
|----------|------------|------------|
| Top-left | 0.5 | 0.5 |
| Center | 5.0 | 2.8 |
| Bottom-right | 9.5 | 5.1 |

## Step 5: Position and Align
After adding elements:
- \`position_element\` - Move/resize individual elements
- \`align_elements\` - Align multiple elements
- \`distribute_elements\` - Space elements evenly

## Step 6: Apply Consistent Styling
- \`apply_text_style\` - Consistent fonts and colors across placeholder types
- Consider establishing a color palette and font hierarchy early

## Tool Selection Guide

| Need | Recommended Tool |
|------|------------------|
| Create structure | \`create_slide\` |
| Add content | \`add_text_box\`, \`add_image\`, \`add_shape\` |
| Position elements | \`position_element\`, \`align_elements\` |
| Style text | \`apply_text_style\` |
| Advanced operations | \`batch_update\` |
`;
}

/**
 * Build the style replication workflow prompt content.
 */
function buildStyleReplicationWorkflow(
  sourceId: string,
  targetId: string
): string {
  return `# Style Replication Workflow

Source (extract styles from): \`${sourceId}\`
Target (apply styles to): \`${targetId}\`

## Step 1: Analyze Source Presentation
Extract the style guide from the source:
\`\`\`
analyze_presentation(presentation_id="${sourceId}")
\`\`\`

Review the output for:
- **Colors**: Primary, secondary, accent, background
- **Fonts**: Heading family, body family, sizes
- **Placeholder patterns**: How titles, subtitles, body text are structured

## Step 2: Document the Style Guide
From the analysis, note:
- Title font: [family, size, color, weight]
- Subtitle font: [family, size, color]
- Body font: [family, size, color]
- Accent color: [hex code]
- Background color: [hex code]

## Step 3: Analyze Target Presentation
Understand what needs to be styled:
\`\`\`
analyze_presentation(presentation_id="${targetId}")
\`\`\`

Identify:
- Which slides have titles/subtitles/body text
- Current styling that needs to change
- Any elements that should retain their styling

## Step 4: Apply Styles to Target

### Option A: Bulk Style Application (Recommended)
Use \`apply_text_style\` for consistent styling:
\`\`\`
apply_text_style(
  presentation_id="${targetId}",
  placeholder_type="TITLE",
  font_family="[from source]",
  font_size=[from source],
  bold=true,
  color="[hex from source]"
)
\`\`\`

Repeat for SUBTITLE and BODY placeholder types.

### Option B: Manual Per-Element Styling
For fine-grained control, use \`batch_update\` with \`updateTextStyle\` requests.

## Step 5: Verify Results
- Use \`export_thumbnail\` to preview styled slides
- Compare visually with source presentation
- Adjust as needed

## Notes
- \`apply_text_style\` works on placeholder types, not individual elements
- For background colors or non-text elements, use \`batch_update\`
- Color values should be hex format (e.g., "#1a73e8")
`;
}
