/**
 * Google Slides MCP Server - Cloudflare Workers Entry Point
 *
 * This is the main entry point for the Cloudflare Workers deployment.
 * It uses OAuthProvider to handle authentication with Google and
 * route MCP requests to the GoogleSlidesMCP Durable Object.
 */

import OAuthProvider from "@cloudflare/workers-oauth-provider";
import { GoogleSlidesMCP } from "./mcp-agent.js";
import { GoogleHandler } from "./auth/google-handler.js";

// Export the Durable Object class for Wrangler
export { GoogleSlidesMCP };

/**
 * Main worker export with OAuth provider configuration.
 *
 * Routes:
 * - /sse: Server-Sent Events transport for MCP clients
 * - /mcp: Streamable HTTP transport for MCP clients
 * - /authorize: OAuth authorization endpoint
 * - /callback: Google OAuth callback
 * - /token: OAuth token endpoint
 * - /register: OAuth client registration
 * - /: Info page
 */
export default new OAuthProvider({
  // MCP API handlers
  apiHandlers: {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    "/sse": GoogleSlidesMCP.serveSSE("/sse") as any,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    "/mcp": GoogleSlidesMCP.serve("/mcp") as any,
  },

  // OAuth endpoints
  authorizeEndpoint: "/authorize",
  tokenEndpoint: "/token",
  clientRegistrationEndpoint: "/register",

  // OAuth scopes supported
  scopesSupported: ["openid", "profile", "email"],

  // Handler for non-API routes (OAuth flow and info pages)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  defaultHandler: GoogleHandler as any,
});
