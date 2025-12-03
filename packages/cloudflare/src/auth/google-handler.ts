/**
 * Google OAuth handler for the MCP server.
 *
 * Handles the OAuth 2.0 flow with Google:
 * 1. /authorize - Redirects to Google consent screen
 * 2. /callback - Exchanges code for tokens and completes MCP auth
 */

import { Hono } from "hono";
import { getCookie, setCookie } from "hono/cookie";
import type {
  ExtendedEnv,
  Props,
  GoogleAuthorizeParams,
  GoogleTokenResponse,
  GoogleUserInfo,
} from "../types.js";
import type { AuthRequest } from "@cloudflare/workers-oauth-provider";

// Google OAuth endpoints
const GOOGLE_AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth";
const GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token";
const GOOGLE_USERINFO_URL = "https://www.googleapis.com/oauth2/v2/userinfo";

// Scopes required for Google Slides and Drive access
const GOOGLE_SCOPES = [
  "https://www.googleapis.com/auth/presentations",
  "https://www.googleapis.com/auth/drive.file",
  "https://www.googleapis.com/auth/userinfo.email",
  "https://www.googleapis.com/auth/userinfo.profile",
].join(" ");

const app = new Hono<{ Bindings: ExtendedEnv }>();

/**
 * Build the Google authorization URL.
 */
function buildGoogleAuthUrl(params: GoogleAuthorizeParams): string {
  const url = new URL(GOOGLE_AUTH_URL);
  url.searchParams.set("client_id", params.clientId);
  url.searchParams.set("redirect_uri", params.redirectUri);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("scope", params.scope);
  url.searchParams.set("state", params.state);
  url.searchParams.set("access_type", params.accessType ?? "offline");
  if (params.prompt) {
    url.searchParams.set("prompt", params.prompt);
  }
  return url.toString();
}

/**
 * Render the approval dialog HTML.
 */
function renderApprovalDialog(
  serverName: string,
  serverDescription: string,
  clientName: string | undefined,
  oauthReqInfoEncoded: string
): string {
  return `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Authorize ${serverName}</title>
  <style>
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      max-width: 500px;
      margin: 50px auto;
      padding: 20px;
      background: #f5f5f5;
    }
    .card {
      background: white;
      border-radius: 12px;
      padding: 30px;
      box-shadow: 0 2px 10px rgba(0,0,0,0.1);
    }
    h1 { color: #333; font-size: 24px; margin-bottom: 10px; }
    .description { color: #666; margin-bottom: 20px; }
    .client-info {
      background: #f9f9f9;
      padding: 15px;
      border-radius: 8px;
      margin-bottom: 20px;
    }
    .client-info strong { color: #333; }
    .scopes {
      background: #fff3cd;
      border: 1px solid #ffc107;
      padding: 15px;
      border-radius: 8px;
      margin-bottom: 20px;
    }
    .scopes h3 { margin-top: 0; color: #856404; }
    .scopes ul { margin: 0; padding-left: 20px; }
    .scopes li { color: #856404; margin: 5px 0; }
    button {
      background: #4285f4;
      color: white;
      border: none;
      padding: 12px 24px;
      border-radius: 6px;
      font-size: 16px;
      cursor: pointer;
      width: 100%;
    }
    button:hover { background: #3367d6; }
  </style>
</head>
<body>
  <div class="card">
    <h1>${serverName}</h1>
    <p class="description">${serverDescription}</p>

    <div class="client-info">
      <strong>Client:</strong> ${clientName ?? "Unknown client"}
    </div>

    <div class="scopes">
      <h3>This app will have access to:</h3>
      <ul>
        <li>View and edit your Google Slides presentations</li>
        <li>View and manage files created by this app</li>
        <li>View your email address and profile</li>
      </ul>
    </div>

    <form method="POST" action="/authorize">
      <input type="hidden" name="oauthReqInfo" value="${oauthReqInfoEncoded}">
      <button type="submit">Authorize with Google</button>
    </form>
  </div>
</body>
</html>
`;
}

/**
 * GET /authorize - Show approval dialog or redirect if already approved.
 */
app.get("/authorize", async (c) => {
  const oauthReqInfo = await c.env.OAUTH_PROVIDER.parseAuthRequest(c.req.raw);
  if (!oauthReqInfo.clientId) {
    return c.text("Missing client_id", 400);
  }

  const clientInfo = await c.env.OAUTH_PROVIDER.lookupClient(
    oauthReqInfo.clientId
  );
  if (!clientInfo) {
    return c.text("Unknown client", 400);
  }

  // Check for existing approval cookie
  const approvalCookie = getCookie(c, `approval_${oauthReqInfo.clientId}`);

  // Encode OAuth request info for form submission
  const oauthReqInfoEncoded = btoa(JSON.stringify(oauthReqInfo));

  if (approvalCookie === "approved") {
    // Skip dialog, redirect directly to Google
    const googleAuthUrl = buildGoogleRedirectUrl(c.req.url, c.env, oauthReqInfo);
    return c.redirect(googleAuthUrl, 302);
  }

  // Show approval dialog
  const html = renderApprovalDialog(
    "Google Slides MCP Server",
    "Access and manage Google Slides presentations via Claude",
    clientInfo.clientName,
    oauthReqInfoEncoded
  );

  return c.html(html);
});

/**
 * POST /authorize - Process approval and redirect to Google.
 */
app.post("/authorize", async (c) => {
  const formData = await c.req.formData();
  const oauthReqInfoEncoded = formData.get("oauthReqInfo") as string;

  if (!oauthReqInfoEncoded) {
    return c.text("Missing OAuth request info", 400);
  }

  const oauthReqInfo: AuthRequest = JSON.parse(atob(oauthReqInfoEncoded));

  // Set approval cookie for future requests
  setCookie(c, `approval_${oauthReqInfo.clientId}`, "approved", {
    httpOnly: true,
    secure: true,
    sameSite: "Lax",
    maxAge: 60 * 60 * 24 * 30, // 30 days
    path: "/",
  });

  const googleAuthUrl = buildGoogleRedirectUrl(c.req.url, c.env, oauthReqInfo);
  return c.redirect(googleAuthUrl, 302);
});

/**
 * Helper to build redirect URL to Google OAuth.
 */
function buildGoogleRedirectUrl(
  requestUrl: string,
  env: ExtendedEnv,
  oauthReqInfo: AuthRequest
): string {
  // Construct base URL from request
  const reqUrl = new URL(requestUrl);
  const baseUrl = `${reqUrl.protocol}//${reqUrl.host}`;
  const redirectUri = new URL("/callback", baseUrl);

  // Encode MCP OAuth info in state parameter
  const state = btoa(JSON.stringify(oauthReqInfo));

  return buildGoogleAuthUrl({
    clientId: env.GOOGLE_CLIENT_ID,
    redirectUri: redirectUri.toString(),
    scope: GOOGLE_SCOPES,
    state,
    accessType: "offline",
    prompt: "consent",
  });
}

/**
 * GET /callback - Handle Google OAuth callback.
 */
app.get("/callback", async (c) => {
  const url = new URL(c.req.url);
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  const error = url.searchParams.get("error");

  if (error) {
    return c.text(`Google OAuth error: ${error}`, 400);
  }

  if (!code || !state) {
    return c.text("Missing code or state parameter", 400);
  }

  // Decode MCP OAuth request info from state
  let oauthReqInfo: AuthRequest;
  try {
    oauthReqInfo = JSON.parse(atob(state));
  } catch {
    return c.text("Invalid state parameter", 400);
  }

  // Exchange code for tokens
  const reqUrl = new URL(c.req.url);
  const baseUrl = `${reqUrl.protocol}//${reqUrl.host}`;
  const redirectUri = new URL("/callback", baseUrl);
  const tokenResponse = await fetch(GOOGLE_TOKEN_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams({
      client_id: c.env.GOOGLE_CLIENT_ID,
      client_secret: c.env.GOOGLE_CLIENT_SECRET,
      code,
      grant_type: "authorization_code",
      redirect_uri: redirectUri.toString(),
    }),
  });

  if (!tokenResponse.ok) {
    const errorText = await tokenResponse.text();
    return c.text(`Token exchange failed: ${errorText}`, 500);
  }

  const tokens: GoogleTokenResponse = await tokenResponse.json();

  // Fetch user info
  const userInfoResponse = await fetch(GOOGLE_USERINFO_URL, {
    headers: {
      Authorization: `Bearer ${tokens.access_token}`,
    },
  });

  if (!userInfoResponse.ok) {
    return c.text("Failed to fetch user info", 500);
  }

  const userInfo: GoogleUserInfo = await userInfoResponse.json();

  // Build props with Google tokens
  const props: Props = {
    email: userInfo.email,
    name: userInfo.name,
    accessToken: tokens.access_token,
    refreshToken: tokens.refresh_token,
    expiresAt: Date.now() + tokens.expires_in * 1000,
  };

  // Complete MCP OAuth authorization
  const { redirectTo } = await c.env.OAUTH_PROVIDER.completeAuthorization({
    request: oauthReqInfo,
    userId: userInfo.id,
    metadata: {
      label: userInfo.email,
    },
    scope: oauthReqInfo.scope,
    props,
  });

  return c.redirect(redirectTo, 302);
});

/**
 * Root handler - show info page.
 */
app.get("/", (c) => {
  return c.html(`
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Google Slides MCP Server</title>
  <style>
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      max-width: 600px;
      margin: 50px auto;
      padding: 20px;
      line-height: 1.6;
    }
    h1 { color: #333; }
    code {
      background: #f4f4f4;
      padding: 2px 6px;
      border-radius: 4px;
    }
    .endpoints {
      background: #f9f9f9;
      padding: 15px;
      border-radius: 8px;
      margin: 20px 0;
    }
    .endpoints dt { font-weight: bold; margin-top: 10px; }
    .endpoints dd { margin-left: 20px; color: #666; }
  </style>
</head>
<body>
  <h1>Google Slides MCP Server</h1>
  <p>This is a Model Context Protocol (MCP) server for Google Slides, running on Cloudflare Workers.</p>

  <div class="endpoints">
    <h3>MCP Endpoints</h3>
    <dl>
      <dt><code>/sse</code></dt>
      <dd>Server-Sent Events transport for MCP clients</dd>
      <dt><code>/mcp</code></dt>
      <dd>Streamable HTTP transport for MCP clients</dd>
    </dl>
  </div>

  <p>To use this server, configure your MCP client (like Claude) to connect to the <code>/sse</code> endpoint.</p>
</body>
</html>
`);
});

export { app as GoogleHandler };
