"""Token storage interface for persisting OAuth credentials.

This module provides an abstraction for storing and retrieving OAuth
credentials, supporting both file-based and in-memory storage.
"""

import json
import os
from abc import ABC, abstractmethod
from pathlib import Path
from typing import Any


class TokenStore(ABC):
    """Abstract base class for token storage."""

    @abstractmethod
    async def store(self, user_id: str, credentials: dict) -> None:
        """Store credentials for a user.

        Args:
            user_id: Unique identifier for the user
            credentials: Credentials dictionary to store
        """
        pass

    @abstractmethod
    async def retrieve(self, user_id: str) -> dict | None:
        """Retrieve credentials for a user.

        Args:
            user_id: Unique identifier for the user

        Returns:
            Credentials dictionary if found, None otherwise
        """
        pass

    @abstractmethod
    async def delete(self, user_id: str) -> None:
        """Delete credentials for a user.

        Args:
            user_id: Unique identifier for the user
        """
        pass


class InMemoryTokenStore(TokenStore):
    """In-memory token storage (for development/testing)."""

    def __init__(self) -> None:
        self._store: dict[str, dict] = {}

    async def store(self, user_id: str, credentials: dict) -> None:
        """Store credentials in memory."""
        self._store[user_id] = credentials

    async def retrieve(self, user_id: str) -> dict | None:
        """Retrieve credentials from memory."""
        return self._store.get(user_id)

    async def delete(self, user_id: str) -> None:
        """Delete credentials from memory."""
        self._store.pop(user_id, None)


class FileTokenStore(TokenStore):
    """File-based token storage.

    Stores credentials as JSON files in a specified directory.
    Each user's credentials are stored in a separate file.
    """

    def __init__(self, directory: str | Path | None = None) -> None:
        """Initialize file-based token store.

        Args:
            directory: Directory for storing credential files.
                      Defaults to ~/.google-slides-mcp/credentials
        """
        if directory is None:
            directory = os.getenv(
                "CREDENTIALS_DIR",
                os.path.expanduser("~/.google-slides-mcp/credentials"),
            )
        self._directory = Path(directory)
        self._directory.mkdir(parents=True, exist_ok=True)

    def _get_path(self, user_id: str) -> Path:
        """Get the file path for a user's credentials."""
        # Sanitize user_id for use as filename
        safe_id = "".join(c if c.isalnum() else "_" for c in user_id)
        return self._directory / f"{safe_id}.json"

    async def store(self, user_id: str, credentials: dict) -> None:
        """Store credentials to a file."""
        path = self._get_path(user_id)
        with open(path, "w") as f:
            json.dump(credentials, f)
        # Restrict file permissions
        os.chmod(path, 0o600)

    async def retrieve(self, user_id: str) -> dict | None:
        """Retrieve credentials from a file."""
        path = self._get_path(user_id)
        if not path.exists():
            return None
        with open(path) as f:
            return json.load(f)

    async def delete(self, user_id: str) -> None:
        """Delete a credentials file."""
        path = self._get_path(user_id)
        if path.exists():
            path.unlink()


def get_token_store(store_type: str = "file") -> TokenStore:
    """Factory function to create a token store.

    Args:
        store_type: Type of store ("file" or "memory")

    Returns:
        TokenStore instance

    Raises:
        ValueError: If store_type is unknown
    """
    if store_type == "file":
        return FileTokenStore()
    elif store_type == "memory":
        return InMemoryTokenStore()
    else:
        raise ValueError(f"Unknown store type: {store_type}")
