/**
 * Google Slides API client using direct REST/fetch().
 *
 * This client provides direct access to the Google Slides API without
 * the googleapis npm package, optimized for Cloudflare Workers.
 */

import type {
  TokenInfo,
  Presentation,
  Page,
  BatchUpdateResponse,
  Thumbnail,
  Request,
} from "./types.js";

const SLIDES_API_BASE = "https://slides.googleapis.com/v1";

/**
 * Client for Google Slides API operations.
 */
export class SlidesClient {
  private accessToken: string;

  constructor(tokenInfo: TokenInfo) {
    this.accessToken = tokenInfo.accessToken;
  }

  /**
   * Make an authenticated request to the Slides API.
   */
  private async request<T>(
    endpoint: string,
    options: RequestInit = {}
  ): Promise<T> {
    const url = `${SLIDES_API_BASE}${endpoint}`;

    const response = await fetch(url, {
      ...options,
      headers: {
        Authorization: `Bearer ${this.accessToken}`,
        "Content-Type": "application/json",
        ...options.headers,
      },
    });

    if (!response.ok) {
      const errorBody = await response.text();
      let errorMessage: string;
      try {
        const errorJson = JSON.parse(errorBody);
        errorMessage =
          errorJson.error?.message || `HTTP ${response.status}: ${errorBody}`;
      } catch {
        errorMessage = `HTTP ${response.status}: ${errorBody}`;
      }
      throw new Error(`Slides API error: ${errorMessage}`);
    }

    return response.json() as Promise<T>;
  }

  /**
   * Retrieve a presentation.
   *
   * @param presentationId - The ID of the presentation to retrieve
   * @param fields - Optional field mask for partial response
   * @returns Presentation resource
   */
  async getPresentation(
    presentationId: string,
    fields?: string
  ): Promise<Presentation> {
    let endpoint = `/presentations/${presentationId}`;
    if (fields) {
      endpoint += `?fields=${encodeURIComponent(fields)}`;
    }
    return this.request<Presentation>(endpoint);
  }

  /**
   * Retrieve a specific page/slide from a presentation.
   *
   * @param presentationId - The ID of the presentation
   * @param pageId - The ID of the page to retrieve
   * @returns Page resource
   */
  async getPage(presentationId: string, pageId: string): Promise<Page> {
    return this.request<Page>(
      `/presentations/${presentationId}/pages/${pageId}`
    );
  }

  /**
   * Execute a batch update on a presentation.
   *
   * @param presentationId - The ID of the presentation to update
   * @param requests - Array of update request objects
   * @returns BatchUpdate response with replies for each request
   */
  async batchUpdate(
    presentationId: string,
    requests: Request[]
  ): Promise<BatchUpdateResponse> {
    return this.request<BatchUpdateResponse>(
      `/presentations/${presentationId}:batchUpdate`,
      {
        method: "POST",
        body: JSON.stringify({ requests }),
      }
    );
  }

  /**
   * Create a new presentation.
   *
   * @param title - Title for the new presentation
   * @returns Created presentation resource
   */
  async createPresentation(title: string): Promise<Presentation> {
    return this.request<Presentation>("/presentations", {
      method: "POST",
      body: JSON.stringify({ title }),
    });
  }

  /**
   * Get a thumbnail for a specific page.
   *
   * @param presentationId - The ID of the presentation
   * @param pageId - The ID of the page
   * @param mimeType - Image format (PNG or JPEG)
   * @returns Thumbnail with contentUrl, width, and height
   */
  async getThumbnail(
    presentationId: string,
    pageId: string,
    mimeType: "PNG" | "JPEG" = "PNG"
  ): Promise<Thumbnail> {
    const thumbnailProperties = encodeURIComponent(
      `thumbnailProperties.mimeType=${mimeType}`
    );
    return this.request<Thumbnail>(
      `/presentations/${presentationId}/pages/${pageId}/thumbnail?${thumbnailProperties}`
    );
  }
}
