/**
 * Type definitions for Google Slides MCP Server.
 */

import type {
  AuthRequest,
  OAuthHelpers,
  ClientInfo,
} from "@cloudflare/workers-oauth-provider";

// Re-export OAuth types
export type { AuthRequest, OAuthHelpers, ClientInfo };

/**
 * User context passed through OAuth flow.
 * Contains the Google access token for API calls.
 */
export interface Props {
  email: string;
  name: string;
  accessToken: string;
  refreshToken?: string;
  expiresAt?: number;
  // Index signature for compatibility with Record<string, unknown>
  [key: string]: string | number | undefined;
}

/**
 * Extended environment with OAuth helpers injected by OAuthProvider.
 */
export interface ExtendedEnv extends Env {
  OAUTH_PROVIDER: OAuthHelpers;
}

/**
 * Parameters for upstream Google OAuth authorization.
 */
export interface GoogleAuthorizeParams {
  clientId: string;
  redirectUri: string;
  scope: string;
  state: string;
  accessType?: "online" | "offline";
  prompt?: "none" | "consent" | "select_account";
}

/**
 * Parameters for exchanging authorization code for tokens.
 */
export interface GoogleTokenParams {
  clientId: string;
  clientSecret: string;
  code: string;
  redirectUri: string;
}

/**
 * Google OAuth token response.
 */
export interface GoogleTokenResponse {
  access_token: string;
  token_type: string;
  expires_in: number;
  refresh_token?: string;
  scope: string;
}

/**
 * Google user info from the userinfo endpoint.
 */
export interface GoogleUserInfo {
  id: string;
  email: string;
  verified_email: boolean;
  name: string;
  given_name?: string;
  family_name?: string;
  picture?: string;
}

/**
 * Options for the approval dialog.
 */
export interface ApprovalDialogOptions {
  clientInfo: ClientInfo;
  serverName: string;
  serverDescription: string;
  existingApproval?: string | null;
  oauthReqInfo: AuthRequest;
  env: ExtendedEnv;
}

/**
 * Create a success response for MCP tools.
 */
export function createSuccessResponse(
  message: string,
  data?: unknown
): { content: Array<{ type: "text"; text: string }> } {
  let text = message;
  if (data !== undefined) {
    text += "\n\n```json\n" + JSON.stringify(data, null, 2) + "\n```";
  }
  return {
    content: [{ type: "text", text }],
  };
}

/**
 * Create an error response for MCP tools.
 */
export function createErrorResponse(
  message: string,
  details?: string
): { content: Array<{ type: "text"; text: string }>; isError: true } {
  let text = `Error: ${message}`;
  if (details) {
    text += `\n\nDetails: ${details}`;
  }
  return {
    content: [{ type: "text", text }],
    isError: true,
  };
}
