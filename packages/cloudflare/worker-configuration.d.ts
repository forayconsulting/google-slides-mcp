/**
 * Environment bindings for the Cloudflare Worker
 */
interface Env {
  // OAuth Secrets (set via wrangler secret put)
  GOOGLE_CLIENT_ID: string;
  GOOGLE_CLIENT_SECRET: string;
  COOKIE_ENCRYPTION_KEY: string;

  // KV Namespace for OAuth token storage
  OAUTH_KV: KVNamespace;

  // Durable Objects
  MCP_OBJECT: DurableObjectNamespace;
}
