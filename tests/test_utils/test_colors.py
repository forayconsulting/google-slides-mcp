"""Tests for color conversion utilities."""

import pytest

from google_slides_mcp.utils.colors import hex_to_rgb, rgb_to_hex


class TestHexToRgb:
    """Tests for hex to RGB conversion."""

    def test_basic_colors(self):
        """Test basic color conversions."""
        assert hex_to_rgb("#FF0000") == {"red": 1.0, "green": 0.0, "blue": 0.0}
        assert hex_to_rgb("#00FF00") == {"red": 0.0, "green": 1.0, "blue": 0.0}
        assert hex_to_rgb("#0000FF") == {"red": 0.0, "green": 0.0, "blue": 1.0}

    def test_without_hash(self):
        """Test conversion without # prefix."""
        result = hex_to_rgb("FF0000")
        assert result == {"red": 1.0, "green": 0.0, "blue": 0.0}

    def test_shorthand(self):
        """Test shorthand hex conversion."""
        result = hex_to_rgb("#F00")
        assert result == {"red": 1.0, "green": 0.0, "blue": 0.0}

    def test_black_and_white(self):
        """Test black and white colors."""
        assert hex_to_rgb("#000000") == {"red": 0.0, "green": 0.0, "blue": 0.0}
        assert hex_to_rgb("#FFFFFF") == {"red": 1.0, "green": 1.0, "blue": 1.0}

    def test_invalid_color(self):
        """Test that invalid colors raise ValueError."""
        with pytest.raises(ValueError):
            hex_to_rgb("invalid")
        with pytest.raises(ValueError):
            hex_to_rgb("#GG0000")


class TestRgbToHex:
    """Tests for RGB to hex conversion."""

    def test_basic_colors(self):
        """Test basic color conversions."""
        assert rgb_to_hex({"red": 1.0, "green": 0.0, "blue": 0.0}) == "#FF0000"
        assert rgb_to_hex({"red": 0.0, "green": 1.0, "blue": 0.0}) == "#00FF00"
        assert rgb_to_hex({"red": 0.0, "green": 0.0, "blue": 1.0}) == "#0000FF"

    def test_black_and_white(self):
        """Test black and white colors."""
        assert rgb_to_hex({"red": 0.0, "green": 0.0, "blue": 0.0}) == "#000000"
        assert rgb_to_hex({"red": 1.0, "green": 1.0, "blue": 1.0}) == "#FFFFFF"

    def test_invalid_range(self):
        """Test that out-of-range values raise ValueError."""
        with pytest.raises(ValueError):
            rgb_to_hex({"red": 1.5, "green": 0.0, "blue": 0.0})
        with pytest.raises(ValueError):
            rgb_to_hex({"red": -0.1, "green": 0.0, "blue": 0.0})


class TestRoundtrip:
    """Tests for roundtrip conversions."""

    def test_hex_roundtrip(self):
        """Test that hex -> rgb -> hex roundtrips."""
        colors = ["#FF5733", "#33FF57", "#3357FF", "#AABBCC"]
        for color in colors:
            rgb = hex_to_rgb(color)
            result = rgb_to_hex(rgb)
            assert result == color
