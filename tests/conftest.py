"""Pytest configuration and fixtures for Google Slides MCP tests."""

import pytest


@pytest.fixture
def sample_presentation_id() -> str:
    """Return a sample presentation ID for testing."""
    return "test_presentation_123"


@pytest.fixture
def sample_slide_id() -> str:
    """Return a sample slide ID for testing."""
    return "test_slide_456"


@pytest.fixture
def sample_element_id() -> str:
    """Return a sample element ID for testing."""
    return "test_element_789"


@pytest.fixture
def sample_presentation_data() -> dict:
    """Return sample presentation data for testing."""
    return {
        "presentationId": "test_presentation_123",
        "title": "Test Presentation",
        "pageSize": {
            "width": {"magnitude": 9144000, "unit": "EMU"},
            "height": {"magnitude": 5143500, "unit": "EMU"},
        },
        "slides": [
            {
                "objectId": "slide_1",
                "pageElements": [
                    {
                        "objectId": "element_1",
                        "size": {
                            "width": {"magnitude": 1828800, "unit": "EMU"},
                            "height": {"magnitude": 914400, "unit": "EMU"},
                        },
                        "transform": {
                            "scaleX": 1,
                            "scaleY": 1,
                            "translateX": 914400,
                            "translateY": 914400,
                            "unit": "EMU",
                        },
                        "shape": {
                            "shapeType": "TEXT_BOX",
                            "text": {
                                "textElements": [
                                    {"textRun": {"content": "Hello World"}}
                                ]
                            },
                        },
                    }
                ],
            }
        ],
        "layouts": [],
        "masters": [],
    }


@pytest.fixture
def mock_credentials():
    """Return mock Google credentials for testing."""

    class MockCredentials:
        token = "mock_access_token"
        expired = False
        valid = True

        def refresh(self, request):
            pass

    return MockCredentials()
