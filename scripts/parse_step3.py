#!/usr/bin/env python3
"""Parse step3.md and create all files described in fenced code blocks.

Handles `// path` annotations for css/json/ts/tsx and skips blocks without a
path annotation (none in step3.md, but safe). The annotation line is stripped.
"""
import os
import re
import sys

import os
_BASE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SRC = os.path.join(_BASE, "docs", "step3.md")
ROOT = _BASE

PATH_RE = re.compile(r"^\s*//\s*([\w./\[\]-]+\.\w+)\b")
PATH_RE_CSS = re.compile(r"^\s*/\*\s*([\w./\[\]-]+\.\w+)\s*\*/")

BLOCK_RE = re.compile(r"```(\w+)?\n(.*?)```", re.DOTALL)


def main():
    with open(SRC, "r", encoding="utf-8") as f:
        content = f.read()

    created, skipped, errors = [], [], []

    for m in BLOCK_RE.finditer(content):
        body = m.group(2)
        lines = body.splitlines()

        path = None
        start = 0
        for i, line in enumerate(lines):
            s = line.strip()
            if not s:
                continue
            pm = PATH_RE.match(line) or PATH_RE_CSS.match(line)
            if pm:
                path = pm.group(1)
                start = i + 1
            break

        if not path:
            skipped.append(lines[0][:60] if lines else "<empty>")
            continue

        text = "\n".join(lines[start:])
        if text and not text.endswith("\n"):
            text += "\n"
        dest = os.path.join(ROOT, path)
        try:
            os.makedirs(os.path.dirname(dest), exist_ok=True)
            with open(dest, "w", encoding="utf-8") as out:
                out.write(text)
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
