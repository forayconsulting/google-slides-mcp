/**
 * Template operation tools for Google Slides.
 *
 * Tools for working with presentation templates: copying, finding and
 * replacing placeholder text and images.
 */

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { SlidesClient } from "../api/slides-client.js";
import { DriveClient } from "../api/drive-client.js";
import type { TokenManager } from "../api/token-manager.js";

const MIME_GOOGLE_SLIDES = "application/vnd.google-apps.presentation";
const MIME_PPTX = "application/vnd.openxmlformats-officedocument.presentationml.presentation";

/**
 * Register template tools with the MCP server.
 */
export function registerTemplateTools(
  server: McpServer,
  tokenManager: TokenManager
): void {
  const slidesClient = new SlidesClient(tokenManager);
  const driveClient = new DriveClient(tokenManager);

  /**
   * copy_template - Copy a Google Slides template to create a new presentation
   */
  server.tool(
    "copy_template",
    "Copy a Google Slides template to create a new presentation. WORKFLOW TIP: After copying, use analyze_presentation to understand the template structure, then replace_placeholders or update_presentation_content to populate content. Can also convert PowerPoint (.pptx) files to native Google Slides format.",
    {
      template_id: z.string().describe("Source presentation ID to copy"),
      new_name: z.string().describe("Name for the new presentation"),
      destination_folder_id: z.string().optional().describe("Optional Drive folder ID for the copy"),
      convert_to_slides: z.boolean().default(false).describe("If true, convert the source file to Google Slides format. Use when copying a .pptx file."),
    },
    async ({ template_id, new_name, destination_folder_id, convert_to_slides }) => {
      try {
        const result = await driveClient.copyFile(
          template_id,
          new_name,
          destination_folder_id,
          convert_to_slides ? MIME_GOOGLE_SLIDES : undefined
        );

        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify({
                presentation_id: result.id,
                url: `https://docs.google.com/presentation/d/${result.id}`,
                converted: convert_to_slides,
              }, null, 2),
            },
          ],
        };
      } catch (error) {
        return {
          content: [
            {
              type: "text" as const,
              text: `Error: ${error instanceof Error ? error.message : String(error)}`,
            },
          ],
          isError: true,
        };
      }
    }
  );

  /**
   * replace_placeholders - Replace placeholder text throughout a presentation
   */
  server.tool(
    "replace_placeholders",
    "Replace placeholder text throughout a presentation. Placeholders can use any format ({{name}}, {name}, [[name]], etc.). The tool will find and replace all occurrences across all slides.",
    {
      presentation_id: z.string().describe("The presentation to modify"),
      replacements: z.record(z.string()).describe("Mapping of placeholder strings to replacement values"),
    },
    async ({ presentation_id, replacements }) => {
      try {
        // Build replaceAllText requests
        const requests = Object.entries(replacements).map(([placeholder, replacement]) => ({
          replaceAllText: {
            containsText: { text: placeholder, matchCase: true },
            replaceText: replacement,
          },
        }));

        const response = await slidesClient.batchUpdate(presentation_id, requests);

        // Extract replacement counts from response
        const counts: Record<string, number> = {};
        const entries = Object.entries(replacements);
        for (let i = 0; i < entries.length; i++) {
          const [placeholder] = entries[i];
          const reply = (response.replies ?? [])[i] as Record<string, unknown> | undefined;
          const replaceAllText = reply?.replaceAllText as Record<string, unknown> | undefined;
          counts[placeholder] = (replaceAllText?.occurrencesChanged as number) ?? 0;
        }

        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify({
                replacements: counts,
                total: Object.values(counts).reduce((a, b) => a + b, 0),
              }, null, 2),
            },
          ],
        };
      } catch (error) {
        return {
          content: [
            {
              type: "text" as const,
              text: `Error: ${error instanceof Error ? error.message : String(error)}`,
            },
          ],
          isError: true,
        };
      }
    }
  );

  /**
   * replace_placeholder_with_image - Replace shapes containing placeholder text with an image
   */
  server.tool(
    "replace_placeholder_with_image",
    "Replace all shapes containing placeholder text with an image. The image will be sized to fit the placeholder shape's bounds.",
    {
      presentation_id: z.string().describe("The presentation to modify"),
      placeholder_text: z.string().describe("Text to search for in shapes"),
      image_url: z.string().describe("URL of the image to insert (must be publicly accessible)"),
      replace_method: z.enum(["CENTER_INSIDE", "CENTER_CROP"]).default("CENTER_INSIDE").describe("How to fit the image"),
    },
    async ({ presentation_id, placeholder_text, image_url, replace_method }) => {
      try {
        const requests = [
          {
            replaceAllShapesWithImage: {
              imageUrl: image_url,
              replaceMethod: replace_method,
              containsText: { text: placeholder_text, matchCase: true },
            },
          },
        ];

        const response = await slidesClient.batchUpdate(presentation_id, requests);

        const reply = (response.replies ?? [])[0] as Record<string, unknown> | undefined;
        const replaceAllShapesWithImage = reply?.replaceAllShapesWithImage as Record<string, unknown> | undefined;
        const occurrences = (replaceAllShapesWithImage?.occurrencesChanged as number) ?? 0;

        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify({ shapes_replaced: occurrences }, null, 2),
            },
          ],
        };
      } catch (error) {
        return {
          content: [
            {
              type: "text" as const,
              text: `Error: ${error instanceof Error ? error.message : String(error)}`,
            },
          ],
          isError: true,
        };
      }
    }
  );

  /**
   * search_presentations - Search for presentations in Google Drive
   */
  server.tool(
    "search_presentations",
    "Search for presentations in Google Drive. TYPICAL WORKFLOW: search_presentations -> copy_template -> analyze_presentation -> replace_placeholders. Use to discover templates or find existing presentations by name.",
    {
      query: z.string().optional().describe("Search term to match against file names"),
      folder_id: z.string().optional().describe("Limit search to a specific folder ID"),
      max_results: z.number().min(1).max(100).default(20).describe("Maximum number of results"),
      page_token: z.string().optional().describe("Token for retrieving the next page of results"),
    },
    async ({ query, folder_id, max_results, page_token }) => {
      try {
        const result = await driveClient.listFiles({
          query,
          mimeTypes: [MIME_GOOGLE_SLIDES, MIME_PPTX],
          folderId: folder_id,
          pageSize: max_results,
          pageToken: page_token,
        });

        // Transform response for better usability
        const presentations = result.files.map((f) => {
          const pres: Record<string, unknown> = {
            id: f.id,
            name: f.name,
            mimeType: f.mimeType,
            createdTime: f.createdTime,
            modifiedTime: f.modifiedTime,
            url: `https://docs.google.com/presentation/d/${f.id}`,
          };
          // Extract owner email if available
          if (f.owners && f.owners.length > 0) {
            pres.owner = f.owners[0].emailAddress;
          }
          return pres;
        });

        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify({
                presentations,
                next_page_token: result.nextPageToken,
                total_returned: presentations.length,
              }, null, 2),
            },
          ],
        };
      } catch (error) {
        return {
          content: [
            {
              type: "text" as const,
              text: `Error: ${error instanceof Error ? error.message : String(error)}`,
            },
          ],
          isError: true,
        };
      }
    }
  );
}
