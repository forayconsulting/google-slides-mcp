#!/usr/bin/env python3
"""OAuth token acquisition script for Google Slides MCP.

This script performs the OAuth consent flow to obtain refresh tokens
for local development and stdio transport usage.

Usage:
    python scripts/get_token.py

The script will:
1. Open a browser for Google OAuth consent
2. Exchange the authorization code for tokens
3. Save credentials to ~/.google-slides-mcp/credentials.json
"""

import json
import os
import sys
from pathlib import Path

from dotenv import load_dotenv
from google_auth_oauthlib.flow import InstalledAppFlow

# Load environment variables
load_dotenv()

# OAuth scopes required for Google Slides MCP
SCOPES = [
    "openid",
    "https://www.googleapis.com/auth/userinfo.email",
    "https://www.googleapis.com/auth/presentations",
    "https://www.googleapis.com/auth/drive.file",
]

# Default credentials storage location
CREDENTIALS_DIR = Path(os.path.expanduser("~/.google-slides-mcp"))
CREDENTIALS_FILE = CREDENTIALS_DIR / "credentials.json"


def get_client_config() -> dict:
    """Build OAuth client configuration from environment variables."""
    client_id = os.getenv("GOOGLE_CLIENT_ID")
    client_secret = os.getenv("GOOGLE_CLIENT_SECRET")

    if not client_id or not client_secret:
        print("Error: GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET must be set.")
        print("Make sure you have a .env file with your credentials.")
        sys.exit(1)

    return {
        "installed": {
            "client_id": client_id,
            "client_secret": client_secret,
            "auth_uri": "https://accounts.google.com/o/oauth2/auth",
            "token_uri": "https://oauth2.googleapis.com/token",
            "redirect_uris": ["http://localhost", "urn:ietf:wg:oauth:2.0:oob"],
        }
    }


def run_oauth_flow() -> dict:
    """Run the OAuth consent flow and return credentials."""
    client_config = get_client_config()

    flow = InstalledAppFlow.from_client_config(client_config, SCOPES)

    print("\n" + "=" * 60)
    print("Google Slides MCP - OAuth Token Acquisition")
    print("=" * 60)
    print("\nA browser window will open for you to authorize access.")
    print("Please sign in with your Google account and grant permissions.\n")

    # Run the local server flow (opens browser automatically)
    credentials = flow.run_local_server(
        port=8080,
        prompt="consent",
        access_type="offline",  # Request refresh token
    )

    return {
        "token": credentials.token,
        "refresh_token": credentials.refresh_token,
        "token_uri": credentials.token_uri,
        "client_id": credentials.client_id,
        "client_secret": credentials.client_secret,
        "scopes": list(credentials.scopes),
        "expiry": credentials.expiry.isoformat() if credentials.expiry else None,
    }


def save_credentials(credentials: dict) -> Path:
    """Save credentials to the credentials file."""
    CREDENTIALS_DIR.mkdir(parents=True, exist_ok=True)

    with open(CREDENTIALS_FILE, "w") as f:
        json.dump(credentials, f, indent=2)

    # Restrict file permissions (owner read/write only)
    os.chmod(CREDENTIALS_FILE, 0o600)

    return CREDENTIALS_FILE


def main():
    """Main entry point."""
    # Check if credentials already exist
    if CREDENTIALS_FILE.exists():
        print(f"Existing credentials found at: {CREDENTIALS_FILE}")
        response = input("Do you want to replace them? [y/N]: ").strip().lower()
        if response != "y":
            print("Aborted.")
            sys.exit(0)

    try:
        # Run OAuth flow
        credentials = run_oauth_flow()

        # Save credentials
        path = save_credentials(credentials)

        print("\n" + "=" * 60)
        print("SUCCESS!")
        print("=" * 60)
        print(f"\nCredentials saved to: {path}")
        print("\nYou can now use the Google Slides MCP server.")
        print("\nTo test, run:")
        print("  source .venv/bin/activate")
        print("  google-slides-mcp --transport stdio")

    except Exception as e:
        print(f"\nError during OAuth flow: {e}")
        sys.exit(1)


if __name__ == "__main__":
    main()
