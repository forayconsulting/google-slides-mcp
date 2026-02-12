/**
 * Google Slides MCP Agent.
 *
 * Extends McpAgent to provide Google Slides functionality through MCP tools.
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { McpAgent } from "agents/mcp";
import type { Props } from "./types.js";
import { registerAllTools } from "./tools/index.js";
import { registerAllPrompts } from "./prompts/index.js";

/**
 * Google Slides MCP Server agent.
 *
 * This class extends McpAgent to create a Durable Object that handles
 * MCP connections and provides Google Slides tools to clients.
 */
export class GoogleSlidesMCP extends McpAgent<Env, Record<string, never>, Props> {
  /**
   * The MCP server instance.
   */
  server = new McpServer(
    {
      name: "Google Slides MCP Server",
      version: "1.0.0",
    },
    {
      instructions: `Google Slides MCP Server provides tools for creating and manipulating Google Slides presentations. Use the semantic tools (position_element, add_text_box, etc.) for common operations, or use batch_update for full API access.

## Brand Defaults

This server is configured for Praecipio Consulting presentations. Default colors (Teal #054950, Orange #C84F09, Burgundy #6A1933, Navy #2B3F60, Mint #92E5B7, Lavender #B699E1) and font (Nunito Sans) are automatically applied. When building from a blank presentation, simply use defaults — they will be Praecipio-branded. Presentations with existing themes will use their own colors via theme extraction.

## Critical Behavioral Guidelines

1. NEVER FABRICATE CONTENT. If the source material (transcript, brief, etc.) does not explicitly state a person's role, a specific date, a metric, or any factual claim, ASK THE USER to confirm before inserting it. Guessing names, titles, roles, or data erodes trust in the output.

2. INSPECT BEFORE YOU EDIT. Before modifying a slide, use inspect_slide (or get_page) to understand its current element structure. Many slides have complex visual layouts (Gantt charts, infographics, multi-column designs) where blindly replacing text produces nonsensical results.

3. VALIDATE AFTER YOU EDIT. After making changes, use inspect_slide to check for overflow warnings, empty placeholders, and formatting issues. Fix any problems before moving to the next slide.

4. RESPECT EXISTING FORMATTING. When replacing text in styled elements:
   - Do NOT insert bullet characters (•, -, *) into cells/shapes that already have paragraph-level bullet formatting.
   - Do NOT assume font sizes — inspect the existing formatting first.
   - When using batch_update to insert text, also set updateTextStyle to maintain consistent formatting.

5. UNDERSTAND SPATIAL RELATIONSHIPS. Elements like Gantt bars, timeline phases, and infographic connectors are positioned by absolute transforms. If you change column headers or date ranges, you MUST also reposition the visual elements to match.

6. CAUTION WITH replace_placeholders AND replaceAllText. These are PRESENTATION-WIDE — they replace every occurrence across all slides. Only use them for uniquely-bracketed tokens like {{CLIENT_NAME}} or [[ENGAGEMENT_DATE]]. NEVER use them for common words or phrases that may appear in titles, labels, or body text. For targeted replacement on a specific slide, use replace_text_on_slide instead.

7. CONTENT-FIRST PATTERN. When populating a template, PLAN ALL CONTENT FIRST before making API calls. Synthesize the complete slide-by-slide content plan from your source materials, then execute updates. Do not interleave content thinking with API calls — this wastes round-trips and leads to inconsistencies.

8. BULK INSPECTION. When you need to inspect 3+ slides, use inspect_slides (plural) to fetch all slide data in a single call. Only use inspect_slide (singular) for inspecting 1–2 specific slides.

9. FORMAT PRESERVATION. deleteText + insertText strips ALL formatting, resetting to Arial 14pt. ALWAYS follow with updateTextStyle to set font family (Nunito Sans), size, bold, italic, and color. Every batch_update that inserts text must pair it with a style request.

10. BOLD ANCHORS. Every table cell containing paragraph-length text needs a bold lead phrase for scannability. For "label: value" cells, bold the label. For numbered agenda items, bold the numbers. Never leave a table with uniform-weight body text.

11. DELETE, DON'T BLANK. Remove unused template elements with deleteObject, never by inserting whitespace. This applies to text boxes, images, shapes, and placeholder elements. Blank-filled elements create ghost artifacts.

12. STRUCTURAL SLIDE PRESERVATION. Never delete legal/confidentiality disclaimer slides or blank back covers from templates. When cleaning up a copied template, categorize each slide: "content" (safe to delete), "structural" (legal, back cover — always keep). Specifically: always preserve the last 1–2 slides of any template.

## Overflow Prevention Rules

- After replacing placeholder text, compare new text length to original. If >1.5x longer, reduce font size or expand the box.
- Cover slide titles: target <=33pt to accommodate long client/project names.
- After ANY text operation, check inspect_slide results. Overflow warnings = BROKEN slide. Fix immediately — reduce font, expand shape, or shorten text. NEVER dismiss overflow with "autofit should handle this."
- Table boundary check: after creating any table, verify table_y + table_height <= 5.63". If exceeded, reduce rows, shrink font, or recreate on a layout with more content area.

## Table Formatting Patterns

- Index/number columns (01, 02, etc.): always bold.
- Header row: bold + theme color background (this is the default for update_table_content with style_header=true).
- "Label: value" cells: bold the label portion, italic the value portion. This requires batch_update with updateTextStyle targeting character ranges — update_table_content alone cannot do this.
- Use \\u000b (vertical tab / soft return) for line breaks within a cell that should stay in the same bullet context. Use \\n only for separate bullet points.
- Ensure formatting consistency across parallel rows — if Week 1 uses a pattern, Week 2 must match exactly.

## Recommended Workflow for Building Decks

When asked to create a presentation from source materials (transcripts, SOWs, briefs):

1. PLAN FIRST. Before touching the API, draft a slide-by-slide outline:
   - Slide number, title, content type (bullets, table, KPI dashboard, etc.)
   - Which tool to use for each slide
   - Present the plan to the user for approval before building

2. CREATE A BLANK PRESENTATION or COPY A TEMPLATE.
   - For blank: use create_slide for each slide
   - For template: use search_presentations → copy_template

3. BUILD SLIDE BY SLIDE. For each slide:
   a. Create the slide (create_slide or composite tool)
   b. Populate content
   c. Run inspect_slide to verify — fix any warnings before continuing

4. PREFER COMPOSITE TOOLS when they fit:
   - create_table_slide for any tabular data (team rosters, deliverables, timelines, agendas)
   - create_dashboard_slide for KPI/metric displays
   - create_chart_slide for bar charts
   These automatically apply theme colors and create professional layouts.

5. USE ATOMIC TOOLS for custom layouts:
   - add_text_box for free-form text blocks
   - add_shape + add_text_box for callout boxes
   - add_line for dividers

## Common Pitfalls

- Tables cannot be repositioned after creation. If a table needs to be at a specific position, set x/y/width/height in the create call correctly the first time.
- create_slide insertion_index is 0-based. Use list_slides to check current count before inserting.
- For PPTX templates, predefined layout names (TITLE_ONLY, BLANK) may not work. Use list_layouts to discover available layout IDs.
- Do NOT attempt to position_element on tables — it will return an error. Delete and recreate instead.
- When building multi-slide decks, build all slides sequentially. Do not skip inspect_slide verification.

## Kickoff Deck Workflow (Template-Based)

When using the Engagement Kick Off Template:

1. COPY the template via copy_template
2. INSPECT ALL SLIDES with inspect_slides to understand the full template structure
3. IDENTIFY structural slides (legal disclaimer = usually last or second-to-last, blank back cover = last slide) — mark these as KEEP
4. REPLACE global placeholders ({{Client}}, {{Project Name}}, dates) via replace_placeholders — use short values to avoid overflow
5. DELETE irrelevant content slides via batch_update deleteObject — but NEVER delete structural slides
6. POPULATE each remaining slide:
   - For tables: use update_table_content, then follow up with batch_update for bold/italic formatting within cells
   - For text boxes: use batch_update insertText + updateTextStyle (always paired)
   - For new slides: prefer the template's standard content layout (white bg + teal subtitle), NOT decorative layouts
7. VERIFY each slide with inspect_slide after population — fix overflow warnings before moving on
8. FINAL PASS: inspect_slides on the entire deck, verify no overflow warnings, verify structural slides are intact at end

Target slide structure for a kickoff deck:
1. Cover (title, subtitle, team names)
2. Agenda (numbered 2-column table, bold numbers)
3. Team (key personnel table, bold names)
4. Engagement Overview (text boxes with bold titles, italic descriptions)
5. Scope (in-scope bullets, out-of-scope italic)
6. Assumptions (bullet list with bold lead phrases)
7. Timeline (Gantt table — columns = actual weeks only, no empty columns)
8. First 2 Weeks (activities table, bold labels, italic values)
9. Key Stakeholders (table — role, name, title, participation)
10. Legal Disclaimer (KEEP from template — do not modify)
11. Back Cover (KEEP from template — do not modify)

Authentication is required. Ensure you have valid Google OAuth credentials configured.`,
    }
  );

  /**
   * Initialize the MCP agent and register all tools.
   */
  async init(): Promise<void> {
    if (!this.props) {
      throw new Error("User props not available - OAuth may not have completed");
    }
    registerAllTools(this.server, this.env, this.props);
    registerAllPrompts(this.server);
  }
}
