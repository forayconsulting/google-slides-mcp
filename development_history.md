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

---

## Phase 3: Template Discovery & Analysis

**Date:** December 2, 2025
**Duration:** ~40 minutes
**Context:** Testing the MCP server with real templates, discovering gaps

### The Challenge

Attempting to use the MCP server with a real corporate template (`Corporate_Template.pptx`) revealed several gaps:

1. **No file discovery:** The server could only work with presentations if you already knew the ID
2. **PPTX files invisible:** PowerPoint files uploaded to Drive weren't being found
3. **No style extraction:** Understanding a template's structure required manual inspection

### Problem 1: OAuth Scope Limitation

**Observed behavior:** `search_presentations` tool found Google Slides files created by the app, but not the uploaded PPTX template.

**Root cause:** The OAuth scope `drive.file` only grants access to files created by or explicitly opened with the app.

**Solution:** Updated `scripts/get_token.py` to use `drive` scope (full Drive access) instead of `drive.file`.

```python
# Before
"https://www.googleapis.com/auth/drive.file"

# After
"https://www.googleapis.com/auth/drive"
```

### Problem 2: No File Search Capability

**The gap:** Users couldn't discover templates by name—they needed to manually find the presentation ID from a URL.

**Solution:** Implemented Drive file search capability:

1. **DriveService.list_files():** New method in `services/drive_service.py` that builds Google Drive API queries with support for:
   - Name search (`name contains 'query'`)
   - MIME type filtering (Google Slides + PPTX)
   - Folder scoping
   - Pagination

2. **search_presentations tool:** New MCP tool in `tools/templates.py` exposing the search capability:
   ```python
   search_presentations(
       query="Corporate_Template",
       folder_id=None,
       max_results=20,
       page_token=None
   )
   ```

### Problem 3: PPTX to Google Slides Conversion

**The gap:** PPTX files couldn't be used directly with Google Slides API tools.

**Solution:** Added conversion support via Google Drive's copy-with-conversion:

1. **DriveService.copy_file():** Added optional `target_mime_type` parameter
2. **copy_template tool:** Added `convert_to_slides` parameter

```python
copy_template(
    template_id="...",
    new_name="My Presentation",
    convert_to_slides=True  # Converts PPTX → native Google Slides
)
```

### Problem 4: Understanding Template Structure

**The insight:** After finding and converting a template, users still needed to manually explore its structure to understand placeholders, colors, fonts, and layout patterns.

**Solution:** Created a comprehensive `analyze_presentation` meta-tool in `tools/analysis.py`:

**What it extracts:**
- **Overview:** Title, slide count, page dimensions, aspect ratio
- **Slide inventory:** All slides categorized by type (cover, content, section divider, mockup, infographic, data visualization, etc.)
- **Color palette:** Unique colors with usage contexts
- **Typography:** Fonts detected, size distribution, primary font
- **Placeholder patterns:** Common placeholder text (`EYEBROW TEXT`, `MM.DD.YYYY`, `Full Name // Job Title`)
- **Recommendations:** Actionable guidance for programmatic usage

**Slide categorization logic:**
- Detects covers (title + body, early in deck)
- Identifies section dividers (minimal elements, "section" in title)
- Recognizes mockups, infographics, data visualizations
- Classifies image-focused vs content-heavy slides

**Output example:**
```json
{
  "overview": {"total_slides": 75, "aspect_ratio": "16:9"},
  "typography": {"primary_font": "Nunito Sans"},
  "placeholder_patterns": {
    "date_patterns": [{"text": "MM.DD.YYYY", "type": "BODY"}],
    "name_patterns": [{"text": "Full Name // Job Title, Company name", "type": "BODY"}]
  },
  "recommendations": [
    "Use slides 3, 4, 5, 6 as cover options",
    "Replace date placeholder 'MM.DD.YYYY' with actual dates",
    "Workflow: copy_template → delete unused → replace_placeholders → add images"
  ]
}
```

### Implementation Summary

**New files created:**
- `src/google_slides_mcp/tools/analysis.py` - analyze_presentation tool

**Files modified:**
- `scripts/get_token.py` - OAuth scope updated to `drive`
- `src/google_slides_mcp/services/drive_service.py` - Added `list_files()` method, `target_mime_type` param to `copy_file()`
- `src/google_slides_mcp/tools/templates.py` - Added `search_presentations` tool, `convert_to_slides` param to `copy_template`
- `src/google_slides_mcp/tools/__init__.py` - Registered analysis tools

**New tools (total now 19):**
| Tool | Purpose |
|------|---------|
| `search_presentations` | Find presentations/templates by name in Google Drive |
| `analyze_presentation` | Deep-dive style guide extraction from any presentation |

**Enhanced tools:**
| Tool | Enhancement |
|------|-------------|
| `copy_template` | Added `convert_to_slides` param for PPTX → Google Slides conversion |

---

## Timeline Summary (Updated)

| Time | Event | Duration |
|------|-------|----------|
| ~17:00-18:00 (Dec 2) | Ideation & PRD (Claude mobile, inflight) | ~1 hour |
| 21:21 | Repository created | — |
| 21:39 | Full project structure implemented | 18 min |
| 22:05 | OAuth documentation added | 26 min |
| 22:52 | Bug fixes and stdio support | 47 min |
| ~23:03-23:42 (Dec 2) | Template discovery & analysis features | ~40 min |

**Total implementation time:** ~2.2 hours
**Total project time (ideation to current state):** ~6.5 hours

---

## Current State (Updated)

**Branch:** `main`

**Project Status:** Functional MCP server with:
- **19 tools** spanning creation, positioning, templates, analysis, and low-level API access
- **Template discovery:** Search for presentations by name across Google Drive
- **PPTX conversion:** Convert PowerPoint files to native Google Slides format
- **Style guide extraction:** Analyze any presentation to understand structure, colors, fonts, and placeholder patterns
- Dual authentication: HTTP transport (per-request OAuth) and stdio transport (stored credentials)
- Semantic positioning using inches with automatic EMU conversion
- Comprehensive development tooling and documentation
