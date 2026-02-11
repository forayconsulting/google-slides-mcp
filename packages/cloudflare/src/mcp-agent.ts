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
- Do NOT attempt to position_element on tables — it will fail silently. Delete and recreate instead.
- When building multi-slide decks, build all slides sequentially. Do not skip inspect_slide verification.

## Suggested Slide Structures

For client kickoff/workshop decks, a proven structure is:
1. Title slide (engagement name, client, date)
2. Agenda/overview
3. Strategic context ("Why now?")
4. Current state metrics (use create_dashboard_slide)
5. Engagement team (use create_table_slide)
6. Approach overview
7-8. Day-by-day agenda (use create_table_slide)
9. Deliverables (use create_table_slide)
10. Timeline & milestones
11. Next steps

This is a suggestion — always adapt to the source material provided.

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
