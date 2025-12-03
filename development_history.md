# Development History: Google Slides MCP Server

This document chronicles the complete development journey of the Google Slides MCP Server, from initial ideation to working implementation.

---

## Phase 1: Ideation & Research

**Date:** December 2, 2025
**Duration:** ~1 hour
**Context:** Inflight WiFi on a plane

### The Problem Statement

The project began with a simple question: *"What is the best way to create beautiful Google Slides programmatically?"*

The core frustration: HTML/CSS provides excellent styling control, but there's no clean path to consistently populate Google Slides templates via code.

### Approaches Evaluated

Four approaches were considered:

| Approach | Pros | Cons |
|----------|------|------|
| **PowerPoint as Intermediate** | Rich styling, good docs, reliable conversion | Some features don't convert perfectly |
| **Google Slides API (Native)** | Native format, supports templates | Extremely verbose, no CSS-like abstractions |
| **HTML → Image → Slides** | Full HTML/CSS power, pixel-perfect | Text isn't editable in final slides |
| **Template + Merge** | Non-technical users can design templates | Limited to text/image replacement |

### Decision: Template + Merge with Native API

The native Google Slides API was selected despite its verbosity. Key insight: *"It's fine that it's verbose. I actually prefer that."*

The API supports all UI operations programmatically:
- Moving elements via `updatePageElementTransform`
- Resizing via scale factors or explicit `updatePageElementSize`
- Centering requires manual EMU calculations (no convenience methods)

**Critical constant discovered:** 914,400 EMU = 1 inch

### The MCP Insight

The pivotal question: *"Would it be possible to create an authenticated MCP server for all these endpoints? Would that be an effective way to 'semantify' these verbose APIs?"*

This reframing changed everything. MCP would provide:
- **Semantic clarity:** `position: "center"` instead of EMU math
- **State management:** Server tracks context, handles object IDs
- **Auth abstraction:** Server manages token refresh transparently
- **Composability:** Higher-level tools combining multiple API calls

### Existing Solutions Evaluated

Research into existing MCP servers revealed a gap:

| Server | Per-Request OAuth | Full Low-Level API | Semantic Helpers |
|--------|-------------------|-------------------|------------------|
| taylorwilsdon/google_workspace_mcp | ✅ | ❌ High-level only | ❌ |
| matteoantoci/google-slides-mcp | ❌ Refresh token | ✅ batchUpdate | ❌ |
| Composio | ❓ Unclear | ✅ Raw + Markdown | ✅ |

**Conclusion:** No existing server combined per-request OAuth 2.1, full batchUpdate passthrough, AND semantic positioning helpers.

### PRD Generated

A comprehensive Product Requirements Document was generated covering:
- 5-tier tool organization (low-level → utility)
- OAuth 2.1 authentication strategy
- All 47 Google Slides API request types catalogued
- Complete project structure and tech stack

---

## Phase 2: Implementation

### Commit 1: Repository Initialization
**Timestamp:** 2025-12-02 21:21:01 -0500
**Commit:** `6b85105`

```
Initial commit
```

Repository created with basic scaffolding (README, LICENSE, .gitignore).

---

### Commit 2: Full Project Structure
**Timestamp:** 2025-12-02 21:39:50 -0500
**Commit:** `99d957f`
**Time since previous:** 18 minutes

```
Initial project structure for Google Slides MCP Server
```

**Major implementation completed in under 20 minutes:**

**Framework Selection:**
- FastMCP 2.x chosen as the MCP server framework
- Python 3.11+ with async/await patterns

**Directory Structure Created:**
```
src/google_slides_mcp/
├── tools/
│   ├── low_level.py      # batch_update, get_presentation, get_page
│   ├── templates.py      # copy_template, replace_placeholders
│   ├── positioning.py    # position_element, distribute_elements, align_elements
│   ├── creation.py       # create_slide, add_text_box, add_image, add_shape
│   └── utility.py        # list_slides, get_element_info, export_thumbnail
├── services/
│   ├── slides_service.py
│   └── drive_service.py
├── utils/
│   ├── units.py          # EMU conversions
│   ├── transforms.py     # Transform matrix helpers
│   └── colors.py         # Color utilities
└── auth/
    └── middleware.py     # OAuth handling
```

**17 Tools Implemented:**

| Category | Tools |
|----------|-------|
| Low-level | `batch_update`, `get_presentation`, `get_page` |
| Templates | `copy_template`, `replace_placeholders`, `replace_placeholder_with_image` |
| Positioning | `position_element`, `align_elements`, `distribute_elements` |
| Creation | `create_slide`, `add_text_box`, `add_image`, `add_shape` |
| Utility | `list_slides`, `get_element_info`, `export_thumbnail` |

**Key Design Decisions:**
- All semantic tools accept **inches** and convert to EMU internally
- Standard slide dimensions: 10" × 5.625" (16:9 aspect ratio)
- Tool functions follow pattern: `ctx: Context` as first parameter

**Development Tooling Configured:**
- ruff for linting
- pytest for testing
- mypy for type checking

---

### Commit 3: OAuth Documentation
**Timestamp:** 2025-12-02 22:05:35 -0500
**Commit:** `38a11b4`
**Time since previous:** 26 minutes

```
Add detailed Google OAuth setup guide
```

**Documentation Created:**
- Comprehensive guide at `docs/google-oauth-setup.md`
- Step-by-step: project creation → API enablement → consent screen → credentials
- Test user configuration for development
- Troubleshooting section for common OAuth issues
- README updated with links to setup guide

---

### Commit 4: Bug Fixes & Stdio Support
**Timestamp:** 2025-12-02 22:52:57 -0500
**Commit:** `0cf09d9`
**Time since previous:** 47 minutes

```
Fix tool registration and add stdio credential support
```

**Bug Fixes Discovered During Testing:**

1. **Parameter Ordering:** Python requires parameters with defaults to come after parameters without defaults. All tool functions reordered so `ctx: Context` comes first.

2. **Type Annotation Compatibility:** Changed `Context` from string annotation (`"Context"`) to direct import for Pydantic TypeAdapter compatibility with FastMCP's tool registration.

3. **MIME Type Format:** `export_thumbnail` was using `"image/png"` but Google API expects `"PNG"`.

4. **Transform Size Calculation:** `transforms.py` was returning intrinsic element size without accounting for scale factors from the transform matrix.

**New Features Added:**

1. **Stdio Credential Support:** Added stored credentials mode for stdio transport, loading from `~/.google-slides-mcp/credentials.json`

2. **Token Acquisition Script:** `scripts/get_token.py` for local OAuth consent flow

3. **Module Execution:** `__main__.py` enables `python -m google_slides_mcp`

**Documentation Updates:**
- Claude Code configuration instructions added to README
- Local development setup section with token acquisition steps

---

## Timeline Summary

| Time | Event | Duration |
|------|-------|----------|
| ~17:00-18:00 | Ideation & PRD (Claude mobile, inflight) | ~1 hour |
| 21:21 | Repository created | — |
| 21:39 | Full project structure implemented | 18 min |
| 22:05 | OAuth documentation added | 26 min |
| 22:52 | Bug fixes and stdio support | 47 min |

**Total implementation time:** ~1.5 hours
**Total project time (ideation to working server):** ~6 hours

---

## Current State

**Branch:** `main` (HEAD at `0cf09d9`)

**Project Status:** Functional MCP server with:
- 17 tools spanning creation, positioning, templates, and low-level API access
- Dual authentication: HTTP transport (per-request OAuth) and stdio transport (stored credentials)
- Semantic positioning using inches with automatic EMU conversion
- Comprehensive development tooling and documentation

**Pending:** `CLAUDE.md` (untracked) containing project instructions for Claude Code assistance.

---

## Architecture Decisions Rationale

### Why FastMCP 2.x?
- Native async support
- Built-in OAuth 2.1 provider infrastructure
- Clean decorator-based tool registration
- Active development and community

### Why Dual Auth Modes?
- **HTTP transport:** Production deployments, multi-user scenarios
- **Stdio transport:** Local development, Claude Desktop integration

### Why Inches Over EMU in Tool APIs?
- Human-readable: `x=2.5` vs `translateX=2286000`
- Reduces errors from manual EMU calculations
- Standard slide is 10" × 5.625" — intuitive dimensions

### Why Expose batch_update?
- Semantic tools cover 80% of use cases
- batch_update provides escape hatch for edge cases
- All 47 Google Slides API request types accessible
- Power users can combine with semantic tools
