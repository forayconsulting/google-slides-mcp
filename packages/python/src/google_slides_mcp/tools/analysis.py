"""Presentation analysis tools for Google Slides.

Tools for deep-diving into presentations to extract style guides,
structural patterns, and usage recommendations.
"""

from typing import TYPE_CHECKING

from fastmcp import Context

if TYPE_CHECKING:
    from fastmcp import FastMCP


def register_analysis_tools(mcp: "FastMCP") -> None:
    """Register analysis tools with the MCP application.

    Args:
        mcp: The FastMCP application instance
    """

    @mcp.tool()
    async def analyze_presentation(
        ctx: Context,
        presentation_id: str,
        include_thumbnails: bool = False,
        max_thumbnail_slides: int = 5,
    ) -> dict:
        """Deep-dive analysis of a presentation to extract style guide information.

        This tool analyzes a presentation's structure, styling, colors, fonts,
        placeholders, and layouts to provide comprehensive guidance for
        programmatic presentation generation.

        Use this when you need to understand a template before using it, or
        to extract styling patterns for consistent presentation creation.

        Args:
            presentation_id: The presentation ID to analyze
            include_thumbnails: Whether to generate thumbnail URLs for key slides
            max_thumbnail_slides: Maximum number of thumbnails to generate (1-10)

        Returns:
            Dictionary with comprehensive analysis:
            - overview: Presentation metadata and statistics
            - slide_inventory: Categorized list of all slides
            - color_palette: Unique colors found with usage context
            - typography: Fonts, sizes, and text styles detected
            - placeholder_patterns: Common placeholder text patterns
            - layout_categories: Slides grouped by layout type
            - recommendations: Suggestions for programmatic usage
            - thumbnails: URLs to key slide thumbnails (if requested)
        """
        from google_slides_mcp.auth.middleware import GoogleAuthMiddleware
        from google_slides_mcp.services.slides_service import SlidesService
        from google_slides_mcp.utils.units import emu_to_inches

        middleware = GoogleAuthMiddleware()
        credentials = await middleware.extract_credentials(ctx)
        service = SlidesService(credentials)

        # Get full presentation data
        presentation = await service.get_presentation(presentation_id)

        # Initialize analysis containers
        colors_found: dict[str, list[str]] = {}  # color -> [contexts]
        fonts_found: dict[str, list[str]] = {}   # font -> [contexts]
        font_sizes: dict[float, int] = {}         # size -> count
        placeholder_texts: list[dict] = []
        slide_categories: dict[str, list[dict]] = {
            "cover": [],
            "section_divider": [],
            "content": [],
            "image_focused": [],
            "data_visualization": [],
            "mockup": [],
            "infographic": [],
            "other": [],
        }

        # Extract page size
        page_size = presentation.get("pageSize", {})
        width_emu = page_size.get("width", {}).get("magnitude", 0)
        height_emu = page_size.get("height", {}).get("magnitude", 0)
        width_inches = emu_to_inches(width_emu)
        height_inches = emu_to_inches(height_emu)

        # Determine aspect ratio
        if width_inches > 0 and height_inches > 0:
            ratio = width_inches / height_inches
            if abs(ratio - 16/9) < 0.1:
                aspect_ratio = "16:9 (Widescreen)"
            elif abs(ratio - 4/3) < 0.1:
                aspect_ratio = "4:3 (Standard)"
            elif abs(ratio - 16/10) < 0.1:
                aspect_ratio = "16:10"
            else:
                aspect_ratio = f"{ratio:.2f}:1 (Custom)"
        else:
            aspect_ratio = "Unknown"

        slides = presentation.get("slides", [])
        slides_info = []

        for i, slide in enumerate(slides):
            slide_id = slide.get("objectId", "")
            page_elements = slide.get("pageElements", [])
            element_count = len(page_elements)

            # Extract slide info
            slide_info = {
                "slide_id": slide_id,
                "index": i,
                "element_count": element_count,
                "title": "",
                "subtitle": "",
                "has_image": False,
                "has_chart": False,
                "has_table": False,
                "placeholder_types": [],
            }

            # Analyze each element
            for element in page_elements:
                # Check element types
                if "image" in element:
                    slide_info["has_image"] = True
                elif "sheetsChart" in element:
                    slide_info["has_chart"] = True
                elif "table" in element:
                    slide_info["has_table"] = True

                # Analyze shapes
                shape = element.get("shape", {})
                if shape:
                    placeholder = shape.get("placeholder", {})
                    placeholder_type = placeholder.get("type")

                    if placeholder_type:
                        slide_info["placeholder_types"].append(placeholder_type)

                    # Extract text content
                    text_data = shape.get("text", {})
                    text_elements = text_data.get("textElements", [])

                    for text_elem in text_elements:
                        text_run = text_elem.get("textRun", {})
                        content = text_run.get("content", "").strip()
                        style = text_run.get("style", {})

                        if content:
                            # Store placeholder text
                            if placeholder_type:
                                if placeholder_type == "TITLE":
                                    slide_info["title"] = content
                                elif placeholder_type == "SUBTITLE":
                                    slide_info["subtitle"] = content

                                placeholder_texts.append({
                                    "type": placeholder_type,
                                    "text": content[:100],  # Truncate
                                    "slide_index": i,
                                })

                            # Extract font info
                            font_family = style.get("fontFamily")
                            if font_family:
                                if font_family not in fonts_found:
                                    fonts_found[font_family] = []
                                context = f"Slide {i+1}"
                                if context not in fonts_found[font_family]:
                                    fonts_found[font_family].append(context)

                            # Extract font size
                            font_size = style.get("fontSize", {}).get("magnitude")
                            if font_size:
                                font_sizes[font_size] = font_sizes.get(font_size, 0) + 1

                            # Extract text color
                            fg_color = style.get("foregroundColor", {}).get("opaqueColor", {})
                            _extract_color(fg_color, f"Text on slide {i+1}", colors_found)

                    # Extract shape colors
                    shape_props = shape.get("shapeProperties", {})
                    bg_fill = shape_props.get("shapeBackgroundFill", {})
                    solid_fill = bg_fill.get("solidFill", {})
                    if solid_fill:
                        color_data = solid_fill.get("color", {})
                        _extract_color(color_data, f"Shape fill on slide {i+1}", colors_found)

                # Extract background colors from page properties
                page_props = slide.get("pageProperties", {})
                bg_fill = page_props.get("pageBackgroundFill", {})
                solid_fill = bg_fill.get("solidFill", {})
                if solid_fill:
                    color_data = solid_fill.get("color", {})
                    _extract_color(color_data, f"Background on slide {i+1}", colors_found)

            # Categorize slide
            category = _categorize_slide(slide_info)
            slide_info["category"] = category
            slide_categories[category].append({
                "index": i,
                "slide_id": slide_id,
                "title": slide_info["title"],
            })

            slides_info.append(slide_info)

        # Generate placeholder pattern analysis
        placeholder_patterns = _analyze_placeholder_patterns(placeholder_texts)

        # Build recommendations
        recommendations = _generate_recommendations(
            slides_info, placeholder_patterns, fonts_found, colors_found
        )

        # Generate thumbnails if requested
        thumbnails = []
        if include_thumbnails:
            from googleapiclient.discovery import build
            slides_service = build("slides", "v1", credentials=credentials)

            # Select key slides for thumbnails
            key_slides = _select_key_slides(slides_info, max_thumbnail_slides)
            for slide_info in key_slides:
                try:
                    thumbnail = (
                        slides_service.presentations()
                        .pages()
                        .getThumbnail(
                            presentationId=presentation_id,
                            pageObjectId=slide_info["slide_id"],
                            thumbnailProperties_mimeType="PNG",
                        )
                        .execute()
                    )
                    thumbnails.append({
                        "slide_index": slide_info["index"],
                        "slide_id": slide_info["slide_id"],
                        "title": slide_info["title"],
                        "category": slide_info.get("category", "unknown"),
                        "url": thumbnail.get("contentUrl", ""),
                    })
                except Exception:
                    pass  # Skip failed thumbnails

        # Build color palette summary
        color_palette = []
        for color, contexts in colors_found.items():
            color_palette.append({
                "color": color,
                "usage_count": len(contexts),
                "contexts": contexts[:5],  # Limit context examples
            })
        color_palette.sort(key=lambda x: x["usage_count"], reverse=True)

        # Build typography summary
        typography = {
            "fonts": list(fonts_found.keys()),
            "primary_font": max(fonts_found.keys(), key=lambda f: len(fonts_found[f])) if fonts_found else None,
            "font_sizes": [
                {"size_pt": size, "count": count}
                for size, count in sorted(font_sizes.items(), key=lambda x: -x[1])[:10]
            ],
        }

        # Build layout categories summary
        layout_summary = {}
        for category, slides_list in slide_categories.items():
            if slides_list:
                layout_summary[category] = {
                    "count": len(slides_list),
                    "slides": slides_list[:10],  # Limit examples
                }

        return {
            "overview": {
                "presentation_id": presentation_id,
                "title": presentation.get("title", "Untitled"),
                "total_slides": len(slides),
                "page_size": {
                    "width_inches": round(width_inches, 2),
                    "height_inches": round(height_inches, 2),
                },
                "aspect_ratio": aspect_ratio,
                "url": f"https://docs.google.com/presentation/d/{presentation_id}",
            },
            "slide_inventory": slides_info,
            "color_palette": color_palette[:20],  # Top 20 colors
            "typography": typography,
            "placeholder_patterns": placeholder_patterns,
            "layout_categories": layout_summary,
            "recommendations": recommendations,
            "thumbnails": thumbnails if include_thumbnails else None,
        }


def _extract_color(color_data: dict, context: str, colors_found: dict) -> None:
    """Extract color from Google Slides color data and add to colors_found."""
    rgb = color_data.get("rgbColor", {})
    theme_color = color_data.get("themeColor")

    if theme_color:
        color_key = f"theme:{theme_color}"
    elif rgb:
        r = int(rgb.get("red", 0) * 255)
        g = int(rgb.get("green", 0) * 255)
        b = int(rgb.get("blue", 0) * 255)
        color_key = f"#{r:02x}{g:02x}{b:02x}"
    else:
        return

    if color_key not in colors_found:
        colors_found[color_key] = []
    if context not in colors_found[color_key]:
        colors_found[color_key].append(context)


def _categorize_slide(slide_info: dict) -> str:
    """Categorize a slide based on its content and structure."""
    title = slide_info["title"].lower()
    placeholders = slide_info["placeholder_types"]
    element_count = slide_info["element_count"]

    # Cover detection
    if any(kw in title for kw in ["cover", "title page"]) or (
        element_count <= 4 and "TITLE" in placeholders and "BODY" in placeholders
        and slide_info["index"] < 15
    ):
        return "cover"

    # Section divider detection
    if any(kw in title for kw in ["section", "divider"]) or (
        element_count <= 3 and "TITLE" in placeholders
        and ("SUBTITLE" in placeholders or element_count == 1)
    ):
        return "section_divider"

    # Data visualization
    if slide_info["has_chart"] or any(kw in title for kw in ["chart", "graph", "table", "data"]):
        return "data_visualization"

    if slide_info["has_table"]:
        return "data_visualization"

    # Infographic detection
    if "infographic" in title or element_count > 15:
        return "infographic"

    # Mockup detection
    if any(kw in title for kw in ["mockup", "phone", "laptop", "device", "smartphone", "notebook"]):
        return "mockup"

    # Image-focused
    if slide_info["has_image"] and element_count <= 5:
        return "image_focused"

    # Content (default for slides with substantial content)
    if "BODY" in placeholders or element_count >= 3:
        return "content"

    return "other"


def _analyze_placeholder_patterns(placeholder_texts: list[dict]) -> dict:
    """Analyze placeholder texts to find common patterns."""
    patterns = {
        "title_patterns": [],
        "subtitle_patterns": [],
        "body_patterns": [],
        "date_patterns": [],
        "name_patterns": [],
    }

    for item in placeholder_texts:
        text = item["text"]
        ptype = item["type"]

        # Detect date patterns
        if any(dp in text for dp in ["MM.DD", "YYYY", "mm/dd", "date"]):
            if text not in [p["text"] for p in patterns["date_patterns"]]:
                patterns["date_patterns"].append({"text": text, "type": ptype})

        # Detect name patterns
        if any(np in text.lower() for np in ["full name", "name //", "job title"]):
            if text not in [p["text"] for p in patterns["name_patterns"]]:
                patterns["name_patterns"].append({"text": text, "type": ptype})

        # Collect by placeholder type
        if ptype == "TITLE":
            if len(patterns["title_patterns"]) < 10:
                patterns["title_patterns"].append(text)
        elif ptype == "SUBTITLE":
            if len(patterns["subtitle_patterns"]) < 10:
                patterns["subtitle_patterns"].append(text)
        elif ptype == "BODY":
            # Only store first 50 chars of body
            if len(patterns["body_patterns"]) < 5:
                patterns["body_patterns"].append(text[:50] + "..." if len(text) > 50 else text)

    return patterns


def _generate_recommendations(
    slides_info: list[dict],
    placeholder_patterns: dict,
    fonts_found: dict,
    colors_found: dict,
) -> list[str]:
    """Generate usage recommendations based on analysis."""
    recommendations = []

    # Slide usage recommendations
    cover_slides = [s for s in slides_info if s.get("category") == "cover"]
    if cover_slides:
        recommendations.append(
            f"Use slides {', '.join(str(s['index']+1) for s in cover_slides[:4])} "
            f"as cover options (found {len(cover_slides)} cover variants)"
        )

    section_slides = [s for s in slides_info if s.get("category") == "section_divider"]
    if section_slides:
        recommendations.append(
            f"Use slides {', '.join(str(s['index']+1) for s in section_slides[:2])} "
            f"as section dividers"
        )

    # Placeholder recommendations
    if placeholder_patterns.get("date_patterns"):
        date_example = placeholder_patterns["date_patterns"][0]["text"]
        recommendations.append(
            f"Replace date placeholder '{date_example}' with actual dates"
        )

    if placeholder_patterns.get("name_patterns"):
        name_example = placeholder_patterns["name_patterns"][0]["text"]
        recommendations.append(
            f"Replace name placeholder '{name_example}' with presenter info"
        )

    # Font recommendation
    if fonts_found:
        primary_font = max(fonts_found.keys(), key=lambda f: len(fonts_found[f]))
        recommendations.append(
            f"Maintain '{primary_font}' as the primary font for consistency"
        )

    # Color recommendation
    if colors_found:
        top_colors = sorted(colors_found.keys(), key=lambda c: len(colors_found[c]), reverse=True)[:3]
        recommendations.append(
            f"Primary brand colors detected: {', '.join(top_colors)}"
        )

    # Workflow recommendation
    recommendations.append(
        "Workflow: copy_template → delete unused slides → replace_placeholders → add images"
    )

    return recommendations


def _select_key_slides(slides_info: list[dict], max_count: int) -> list[dict]:
    """Select key representative slides for thumbnails."""
    key_slides = []
    categories_seen = set()

    # Prioritize one from each category
    priority_order = ["cover", "section_divider", "content", "data_visualization", "mockup", "infographic"]

    for category in priority_order:
        if len(key_slides) >= max_count:
            break
        for slide in slides_info:
            if slide.get("category") == category and category not in categories_seen:
                key_slides.append(slide)
                categories_seen.add(category)
                break

    # Fill remaining slots with other slides
    for slide in slides_info:
        if len(key_slides) >= max_count:
            break
        if slide not in key_slides:
            key_slides.append(slide)

    return key_slides[:max_count]
