#!/usr/bin/env python3
"""Parse docs/step5.md and create files described in fenced code blocks.

Handles:
- `// path` (ts/tsx/js/json)
- `# path` / bare `# ...` for markdown blocks (path on first line after ```)
- Parenthesized route-group paths `(auth)`, `(rider)`, `(contractor)`.

Special: the two i18n "additions" blocks are NOT full files — they are merge
additions. They are written to `*.additions.json` next to the existing locale
files so the originals are not clobbered.
"""
import os
import re

_BASE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SRC = os.path.join(_BASE, "docs", "step5.md")
ROOT = _BASE

PATH_RE = re.compile(r"^\s*//\s*([\w./\[\]()-]+\.\w+)\b")
PATH_RE_HASH = re.compile(r"^\s*#\s*([\w./\[\]()-]+\.\w+)\b")

BLOCK_RE = re.compile(r"```(\w+)?\n(.*?)```", re.DOTALL)


def first_annotation(lines, lang):
    for i, line in enumerate(lines):
        s = line.strip()
        if not s:
            continue
        if s.startswith("//"):
            pm = PATH_RE.match(line)
            if pm:
                return pm.group(1), i + 1
        elif s.startswith("#"):
            pm = PATH_RE_HASH.match(line)
            if pm:
                return pm.group(1), i + 1
            # markdown block with heading as first line -> treat filename from comment above?
            # Some md blocks have the path comment as `// ...` already handled; here `# path` only.
        break
    return None, None


def main():
    with open(SRC, "r", encoding="utf-8") as f:
        content = f.read()

    created, skipped, errors = [], [], []

    for m in BLOCK_RE.finditer(content):
        lang = (m.group(1) or "").lower()
        lines = m.group(2).splitlines()

        path, start = first_annotation(lines, lang)
        if not path:
            skipped.append(lines[0][:60] if lines else "<empty>")
            continue

        # i18n "additions" blocks: redirect to a sidecar file.
        if "additions" in lines[0] and path.endswith(".json"):
            path = path.replace(".json", ".additions.json")

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
        raise SystemExit(1)


if __name__ == "__main__":
    main()
