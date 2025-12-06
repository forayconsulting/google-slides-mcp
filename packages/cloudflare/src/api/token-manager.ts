/**
 * Token manager for Google OAuth tokens.
 *
 * Handles automatic token refresh when the access token expires.
 */

const GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token";

// Refresh 5 minutes before expiration to avoid race conditions
const REFRESH_BUFFER_MS = 5 * 60 * 1000;

export interface TokenManagerConfig {
  accessToken: string;
  refreshToken?: string;
  expiresAt?: number;
  clientId: string;
  clientSecret: string;
}

interface TokenRefreshResponse {
  access_token: string;
  expires_in: number;
  token_type: string;
  scope?: string;
}

/**
 * Manages Google OAuth tokens with automatic refresh.
 */
export class TokenManager {
  private accessToken: string;
  private refreshToken?: string;
  private expiresAt?: number;
  private clientId: string;
  private clientSecret: string;
  private refreshPromise?: Promise<string>;

  constructor(config: TokenManagerConfig) {
    this.accessToken = config.accessToken;
    this.refreshToken = config.refreshToken;
    this.expiresAt = config.expiresAt;
    this.clientId = config.clientId;
    this.clientSecret = config.clientSecret;
  }

  /**
   * Check if the current access token is expired or about to expire.
   */
  private isTokenExpired(): boolean {
    if (!this.expiresAt) {
      // If we don't know when it expires, assume it might be expired
      // and let the API call fail naturally if it is
      return false;
    }
    return Date.now() >= this.expiresAt - REFRESH_BUFFER_MS;
  }

  /**
   * Refresh the access token using the refresh token.
   */
  private async refreshAccessToken(): Promise<string> {
    if (!this.refreshToken) {
      throw new Error("No refresh token available. Please re-authenticate.");
    }

    const response = await fetch(GOOGLE_TOKEN_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams({
        client_id: this.clientId,
        client_secret: this.clientSecret,
        refresh_token: this.refreshToken,
        grant_type: "refresh_token",
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Token refresh failed: ${errorText}`);
    }

    const tokens: TokenRefreshResponse = await response.json();

    // Update stored tokens
    this.accessToken = tokens.access_token;
    this.expiresAt = Date.now() + tokens.expires_in * 1000;

    return this.accessToken;
  }

  /**
   * Get a valid access token, refreshing if necessary.
   *
   * This method is safe to call concurrently - only one refresh
   * will be performed at a time.
   */
  async getAccessToken(): Promise<string> {
    if (!this.isTokenExpired()) {
      return this.accessToken;
    }

    // If a refresh is already in progress, wait for it
    if (this.refreshPromise) {
      return this.refreshPromise;
    }

    // Start a new refresh
    this.refreshPromise = this.refreshAccessToken().finally(() => {
      this.refreshPromise = undefined;
    });

    return this.refreshPromise;
  }
}
