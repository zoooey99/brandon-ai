"""
Diff Utilities for Prompt Version Comparison.
Generates side-by-side diffs for the admin UI.
"""

import difflib
from typing import List, Tuple, Dict


def generate_unified_diff(
    old_text: str,
    new_text: str,
    old_label: str = "old",
    new_label: str = "new"
) -> str:
    """
    Generate a unified diff string.

    Args:
        old_text: Original text content
        new_text: New text content
        old_label: Label for the old version (e.g., "Version 3")
        new_label: Label for the new version (e.g., "Version 5")

    Returns:
        Unified diff string
    """
    old_lines = old_text.splitlines(keepends=True)
    new_lines = new_text.splitlines(keepends=True)

    diff = difflib.unified_diff(
        old_lines,
        new_lines,
        fromfile=old_label,
        tofile=new_label
    )

    return "".join(diff)


def generate_side_by_side_diff(
    old_text: str,
    new_text: str
) -> List[Dict]:
    """
    Generate side-by-side diff for HTML rendering.

    Each item in the returned list represents a pair of lines:
    {
        "type": "same" | "added" | "removed" | "changed",
        "old_line_num": int or None,
        "new_line_num": int or None,
        "old_content": str or "",
        "new_content": str or ""
    }

    Args:
        old_text: Original text content
        new_text: New text content

    Returns:
        List of diff line dicts for rendering
    """
    old_lines = old_text.splitlines()
    new_lines = new_text.splitlines()

    # Use SequenceMatcher for better alignment
    matcher = difflib.SequenceMatcher(None, old_lines, new_lines)

    result = []
    old_line_num = 0
    new_line_num = 0

    for tag, i1, i2, j1, j2 in matcher.get_opcodes():
        if tag == "equal":
            # Lines are the same
            for i in range(i2 - i1):
                old_line_num += 1
                new_line_num += 1
                result.append({
                    "type": "same",
                    "old_line_num": old_line_num,
                    "new_line_num": new_line_num,
                    "old_content": old_lines[i1 + i],
                    "new_content": new_lines[j1 + i]
                })

        elif tag == "replace":
            # Lines changed - show side by side
            old_count = i2 - i1
            new_count = j2 - j1
            max_count = max(old_count, new_count)

            for i in range(max_count):
                old_idx = i1 + i if i < old_count else None
                new_idx = j1 + i if i < new_count else None

                if old_idx is not None:
                    old_line_num += 1
                if new_idx is not None:
                    new_line_num += 1

                result.append({
                    "type": "changed",
                    "old_line_num": old_line_num if old_idx is not None else None,
                    "new_line_num": new_line_num if new_idx is not None else None,
                    "old_content": old_lines[old_idx] if old_idx is not None else "",
                    "new_content": new_lines[new_idx] if new_idx is not None else ""
                })

        elif tag == "delete":
            # Lines only in old
            for i in range(i2 - i1):
                old_line_num += 1
                result.append({
                    "type": "removed",
                    "old_line_num": old_line_num,
                    "new_line_num": None,
                    "old_content": old_lines[i1 + i],
                    "new_content": ""
                })

        elif tag == "insert":
            # Lines only in new
            for i in range(j2 - j1):
                new_line_num += 1
                result.append({
                    "type": "added",
                    "old_line_num": None,
                    "new_line_num": new_line_num,
                    "old_content": "",
                    "new_content": new_lines[j1 + i]
                })

    return result


def get_diff_stats(old_text: str, new_text: str) -> Dict[str, int]:
    """
    Calculate diff statistics.

    Returns:
        Dict with lines_added, lines_removed, lines_changed
    """
    old_lines = old_text.splitlines()
    new_lines = new_text.splitlines()

    matcher = difflib.SequenceMatcher(None, old_lines, new_lines)

    lines_added = 0
    lines_removed = 0
    lines_changed = 0

    for tag, i1, i2, j1, j2 in matcher.get_opcodes():
        if tag == "insert":
            lines_added += (j2 - j1)
        elif tag == "delete":
            lines_removed += (i2 - i1)
        elif tag == "replace":
            # Count the max as "changed" lines
            old_count = i2 - i1
            new_count = j2 - j1
            if old_count == new_count:
                lines_changed += old_count
            else:
                # Asymmetric change: show as adds/removes
                if new_count > old_count:
                    lines_changed += old_count
                    lines_added += (new_count - old_count)
                else:
                    lines_changed += new_count
                    lines_removed += (old_count - new_count)

    return {
        "lines_added": lines_added,
        "lines_removed": lines_removed,
        "lines_changed": lines_changed
    }


def highlight_inline_changes(old_line: str, new_line: str) -> Tuple[str, str]:
    """
    Highlight character-level changes within a line pair.
    Returns HTML with <mark> tags around changed parts.

    Args:
        old_line: Original line content
        new_line: New line content

    Returns:
        Tuple of (old_html, new_html) with highlighted changes
    """
    if old_line == new_line:
        return (old_line, new_line)

    # Use character-level diff
    matcher = difflib.SequenceMatcher(None, old_line, new_line)

    old_parts = []
    new_parts = []

    for tag, i1, i2, j1, j2 in matcher.get_opcodes():
        old_segment = _escape_html(old_line[i1:i2])
        new_segment = _escape_html(new_line[j1:j2])

        if tag == "equal":
            old_parts.append(old_segment)
            new_parts.append(new_segment)
        elif tag == "replace":
            old_parts.append(f'<mark class="diff-char-removed">{old_segment}</mark>')
            new_parts.append(f'<mark class="diff-char-added">{new_segment}</mark>')
        elif tag == "delete":
            old_parts.append(f'<mark class="diff-char-removed">{old_segment}</mark>')
        elif tag == "insert":
            new_parts.append(f'<mark class="diff-char-added">{new_segment}</mark>')

    return ("".join(old_parts), "".join(new_parts))


def _escape_html(text: str) -> str:
    """Escape HTML special characters."""
    return (
        text
        .replace("&", "&amp;")
        .replace("<", "&lt;")
        .replace(">", "&gt;")
        .replace('"', "&quot;")
        .replace("'", "&#39;")
    )
