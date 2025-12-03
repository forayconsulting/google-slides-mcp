"""Tests for unit conversion utilities."""

import pytest

from google_slides_mcp.utils.units import (
    EMU_PER_INCH,
    EMU_PER_POINT,
    emu_to_inches,
    emu_to_points,
    inches_to_emu,
    points_to_emu,
)


class TestInchesConversion:
    """Tests for inch/EMU conversions."""

    def test_inches_to_emu(self):
        """Test inches to EMU conversion."""
        assert inches_to_emu(1.0) == EMU_PER_INCH
        assert inches_to_emu(0.5) == EMU_PER_INCH // 2
        assert inches_to_emu(10.0) == 9144000

    def test_emu_to_inches(self):
        """Test EMU to inches conversion."""
        assert emu_to_inches(EMU_PER_INCH) == 1.0
        assert emu_to_inches(9144000) == 10.0
        assert emu_to_inches(0) == 0.0

    def test_roundtrip(self):
        """Test that conversion roundtrips correctly."""
        original = 5.5
        converted = emu_to_inches(inches_to_emu(original))
        assert abs(converted - original) < 0.0001


class TestPointsConversion:
    """Tests for point/EMU conversions."""

    def test_points_to_emu(self):
        """Test points to EMU conversion."""
        assert points_to_emu(1.0) == EMU_PER_POINT
        assert points_to_emu(72.0) == 72 * EMU_PER_POINT

    def test_emu_to_points(self):
        """Test EMU to points conversion."""
        assert emu_to_points(EMU_PER_POINT) == 1.0
        assert emu_to_points(0) == 0.0

    def test_roundtrip(self):
        """Test that conversion roundtrips correctly."""
        original = 18.0
        converted = emu_to_points(points_to_emu(original))
        assert abs(converted - original) < 0.0001
