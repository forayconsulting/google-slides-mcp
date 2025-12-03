"""Configuration management for Google Slides MCP Server.

Uses pydantic-settings for environment variable loading and validation.
"""

import os
from typing import Literal

from pydantic import Field
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    """Application settings loaded from environment variables."""

    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        case_sensitive=False,
        extra="ignore",
    )

    # Google OAuth credentials
    google_client_id: str | None = Field(
        default=None,
        description="Google OAuth 2.0 client ID",
    )
    google_client_secret: str | None = Field(
        default=None,
        description="Google OAuth 2.0 client secret",
    )
    google_service_account_key: str | None = Field(
        default=None,
        description="Path to service account JSON key file",
    )

    # Server configuration
    mcp_server_host: str = Field(
        default="0.0.0.0",
        description="Host to bind the server to",
    )
    mcp_server_port: int = Field(
        default=8000,
        description="Port to bind the server to",
    )
    mcp_transport: Literal["stdio", "streamable-http", "sse"] = Field(
        default="stdio",
        description="Transport protocol to use",
    )

    # OAuth 2.1 settings
    mcp_enable_oauth21: bool = Field(
        default=False,
        description="Enable OAuth 2.1 authentication",
    )
    mcp_base_url: str = Field(
        default="http://localhost:8000",
        description="Base URL for OAuth callbacks",
    )

    # Credential storage
    credentials_dir: str = Field(
        default="~/.google-slides-mcp/credentials",
        description="Directory for storing credentials",
    )

    # Logging
    log_level: Literal["DEBUG", "INFO", "WARNING", "ERROR", "CRITICAL"] = Field(
        default="INFO",
        description="Logging level",
    )

    @property
    def credentials_path(self) -> str:
        """Get the expanded credentials directory path."""
        return os.path.expanduser(self.credentials_dir)

    def has_oauth_credentials(self) -> bool:
        """Check if OAuth credentials are configured."""
        return bool(self.google_client_id and self.google_client_secret)

    def has_service_account(self) -> bool:
        """Check if service account is configured."""
        if not self.google_service_account_key:
            return False
        path = os.path.expanduser(self.google_service_account_key)
        return os.path.exists(path)


def get_settings() -> Settings:
    """Get application settings.

    Returns:
        Settings instance with values from environment
    """
    return Settings()
