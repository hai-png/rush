#!/usr/bin/env python3
"""Parse scaffold.md and create all files described in fenced code blocks.

Each block is annotated with a path comment like:
    // packages/api/src/app.ts
    // services/payments/provider.ts
    # package.json
    # turbo.json
The comment style (// or #) is inferred from the block's language, but we just
look for a path-like string on the first line of the block.
"""
import os
import re
import sys

import os
_BASE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SRC = os.path.join(_BASE, "docs", "scaffold.md")
ROOT = _BASE

# Patterns that identify the file path annotation line.
PATH_RE = re.compile(r"^\s*//\s*(\S+\.\w+)\s*$")
PATH_RE_HASH = re.compile(r"^\s*#\s*(\S+\.\w+)\s*$")

# Match fenced code blocks: ```lang ... ```
BLOCK_RE = re.compile(r"```(\w+)?\n(.*?)```", re.DOTALL)


def main():
    with open(SRC, "r", encoding="utf-8") as f:
        content = f.read()

    created = []
    skipped = []
    errors = []

    for m in BLOCK_RE.finditer(content):
        lang = (m.group(1) or "").lower()
        body = m.group(2)

        # The first non-empty line should be the path annotation.
        lines = body.splitlines()
        path = None
        start_idx = 0
        for i, line in enumerate(lines):
            s = line.strip()
            if not s:
                continue
            if lang in ("jsonc", "ts", "js") and s.startswith("//"):
                pm = PATH_RE.match(line)
                if pm:
                    path = pm.group(1)
                    start_idx = i + 1
                    break
            elif lang in ("json",) and s.startswith("#"):
                pm = PATH_RE_HASH.match(line)
                if pm:
                    path = pm.group(1)
                    start_idx = i + 1
                    break
            # For json blocks, annotation may be `//` too in this doc.
            elif lang == "json" and s.startswith("//"):
                pm = PATH_RE.match(line)
                if pm:
                    path = pm.group(1)
                    start_idx = i + 1
                    break
            # If first non-empty line is not an annotation, skip block.
            else:
                break

        if not path:
            skipped.append(body.splitlines()[0][:60] if body.splitlines() else "<empty>")
            continue

        # Reconstruct file content without the annotation line.
        file_content = "\n".join(lines[start_idx:])
        if file_content and not file_content.endswith("\n"):
            file_content += "\n"

        dest = os.path.join(ROOT, path)
        try:
            os.makedirs(os.path.dirname(dest), exist_ok=True)
            with open(dest, "w", encoding="utf-8") as out:
                out.write(file_content)
            created.append(path)
        except Exception as e:
            errors.append((path, str(e)))

    print(f"Created {len(created)} files.")
    for p in created:
        print(f"  + {p}")
    if skipped:
        print(f"\nSkipped {len(skipped)} blocks (no path annotation):")
        for s in skipped:
            print(f"  - {s}")
    if errors:
        print(f"\nErrors ({len(errors)}):")
        for p, e in errors:
            print(f"  ! {p}: {e}")
        sys.exit(1)


if __name__ == "__main__":
    main()
