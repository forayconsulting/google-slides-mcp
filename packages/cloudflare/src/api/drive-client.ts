/**
 * Google Drive API client using direct REST/fetch().
 *
 * This client provides direct access to the Google Drive API without
 * the googleapis npm package, optimized for Cloudflare Workers.
 */

import type { TokenInfo, DriveFile, FileList } from "./types.js";
import type { TokenManager } from "./token-manager.js";

const DRIVE_API_BASE = "https://www.googleapis.com/drive/v3";

/**
 * Token provider can be a static token or a token manager.
 */
export type TokenProvider = TokenInfo | TokenManager;

/**
 * Client for Google Drive API operations.
 */
export class DriveClient {
  private tokenProvider: TokenProvider;

  constructor(tokenProvider: TokenProvider) {
    this.tokenProvider = tokenProvider;
  }

  /**
   * Get the current access token, refreshing if necessary.
   */
  private async getAccessToken(): Promise<string> {
    if ("getAccessToken" in this.tokenProvider) {
      // It's a TokenManager
      return this.tokenProvider.getAccessToken();
    }
    // It's a static TokenInfo
    return this.tokenProvider.accessToken;
  }

  /**
   * Make an authenticated request to the Drive API.
   */
  private async request<T>(
    endpoint: string,
    options: RequestInit = {}
  ): Promise<T> {
    const url = `${DRIVE_API_BASE}${endpoint}`;
    const accessToken = await this.getAccessToken();

    const response = await fetch(url, {
      ...options,
      headers: {
        Authorization: `Bearer ${accessToken}`,
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
      throw new Error(`Drive API error: ${errorMessage}`);
    }

    return response.json() as Promise<T>;
  }

  /**
   * Copy a file to create a new file.
   *
   * Used for copying presentation templates. Can also convert between
   * formats by specifying a target MIME type.
   *
   * @param fileId - ID of the file to copy
   * @param newName - Name for the new file
   * @param parentFolderId - Optional folder ID for the copy
   * @param targetMimeType - Optional target MIME type for conversion
   * @returns The newly created file resource
   */
  async copyFile(
    fileId: string,
    newName: string,
    parentFolderId?: string,
    targetMimeType?: string
  ): Promise<DriveFile> {
    const body: Record<string, unknown> = { name: newName };
    if (parentFolderId) {
      body.parents = [parentFolderId];
    }
    if (targetMimeType) {
      body.mimeType = targetMimeType;
    }

    return this.request<DriveFile>(`/files/${fileId}/copy`, {
      method: "POST",
      body: JSON.stringify(body),
    });
  }

  /**
   * Get file metadata.
   *
   * @param fileId - ID of the file
   * @param fields - Fields to include in response
   * @returns File metadata
   */
  async getFile(
    fileId: string,
    fields = "id,name,mimeType"
  ): Promise<DriveFile> {
    return this.request<DriveFile>(
      `/files/${fileId}?fields=${encodeURIComponent(fields)}`
    );
  }

  /**
   * Export a Google Workspace file to a different format.
   *
   * @param fileId - ID of the file to export
   * @param mimeType - Target MIME type (e.g., "application/pdf")
   * @returns File content as ArrayBuffer
   */
  async exportFile(fileId: string, mimeType: string): Promise<ArrayBuffer> {
    const url = `${DRIVE_API_BASE}/files/${fileId}/export?mimeType=${encodeURIComponent(mimeType)}`;
    const accessToken = await this.getAccessToken();

    const response = await fetch(url, {
      headers: {
        Authorization: `Bearer ${accessToken}`,
      },
    });

    if (!response.ok) {
      const errorBody = await response.text();
      throw new Error(`Drive API error: HTTP ${response.status}: ${errorBody}`);
    }

    return response.arrayBuffer();
  }

  /**
   * List files matching the given criteria.
   *
   * @param options - Search options
   * @returns List of files with optional pagination token
   */
  async listFiles(options: {
    query?: string;
    mimeTypes?: string[];
    folderId?: string;
    pageSize?: number;
    pageToken?: string;
    includeTrashed?: boolean;
  } = {}): Promise<FileList> {
    const {
      query,
      mimeTypes,
      folderId,
      pageSize = 20,
      pageToken,
      includeTrashed = false,
    } = options;

    // Build query clauses
    const clauses: string[] = [];

    if (query) {
      // Escape single quotes in the query
      const escapedQuery = query.replace(/'/g, "\\'");
      clauses.push(`name contains '${escapedQuery}'`);
    }

    if (mimeTypes && mimeTypes.length > 0) {
      const mimeConditions = mimeTypes
        .map((mt) => `mimeType = '${mt}'`)
        .join(" or ");
      clauses.push(`(${mimeConditions})`);
    }

    if (folderId) {
      clauses.push(`'${folderId}' in parents`);
    }

    if (!includeTrashed) {
      clauses.push("trashed = false");
    }

    // Combine clauses with AND
    const q = clauses.length > 0 ? clauses.join(" and ") : undefined;

    // Clamp page_size to valid range
    const clampedPageSize = Math.max(1, Math.min(100, pageSize));

    // Build URL parameters
    const params = new URLSearchParams();
    params.set("pageSize", clampedPageSize.toString());
    params.set(
      "fields",
      "nextPageToken,files(id,name,mimeType,createdTime,modifiedTime,owners)"
    );

    if (q) {
      params.set("q", q);
    }
    if (pageToken) {
      params.set("pageToken", pageToken);
    }

    return this.request<FileList>(`/files?${params.toString()}`);
  }
}
