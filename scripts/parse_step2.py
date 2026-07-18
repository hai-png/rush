#!/usr/bin/env python3
"""Parse step2.md and create all files described in fenced code blocks.

Handles:
- `// path` annotations (ts/js/jsonc)
- `# path` annotations (json/dockerfile/yaml where used)
- Multi-segment blocks where several `// file ...` comments (optionally with
  description text) appear before each file's body (e.g. services/sms has 3 files
  in one block, and apps/worker handlers reference one file per block).
- Unannotated blocks (the CI yaml excerpt and the health-check comment) are skipped.
"""
import os
import re
import sys

import os
_BASE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SRC = os.path.join(_BASE, "docs", "step2.md")
ROOT = _BASE

# A path annotation line: `// packages/.../file.ts` optionally followed by text,
# or `// path (comment)`.
PATH_RE = re.compile(r"^\s*//\s*([\w./-]+\.\w+|[\w./-]*Caddyfile|[\w./-]*Dockerfile)\b")
PATH_RE_HASH = re.compile(r"^\s*#\s*([\w./-]+\.\w+|[\w./-]*Caddyfile)\b")

BLOCK_RE = re.compile(r"```(\w+)?\n(.*?)```", re.DOTALL)


def first_annotation(lines, lang):
    """Return (path, content_start_index) for a block, or (None, None)."""
    for i, line in enumerate(lines):
        s = line.strip()
        if not s:
            continue
        if s.startswith("//"):
            m = PATH_RE.match(line)
            if m and not s.startswith("// " + " ") and len(s) - len(s.lstrip()) < 4:
                return m.group(1), i + 1
        elif s.startswith("#"):
            m = PATH_RE_HASH.match(line)
            if m:
                return m.group(1), i + 1
        else:
            break
    return None, None


def split_multi_file(block_body):
    """Split a block into (path, content) segments for blocks containing multiple
    `// path` annotations. Returns list of (path, content_lines)."""
    lines = block_body.splitlines()
    # Find indices of annotation lines
    segs = []
    current = None
    for i, line in enumerate(lines):
        m = PATH_RE.match(line)
        if m and (not line.lstrip().startswith("//  ") or line.lstrip().startswith("// ") and len(line.lstrip()) - 3 < 60):
            if current is not None:
                segs.append((current[0], lines[current[1]:i]))
            current = (m.group(1), i + 1)
    if current is not None:
        segs.append((current[0], lines[current[1]:]))
    return segs


def main():
    with open(SRC, "r", encoding="utf-8") as f:
        content = f.read()

    created, skipped, errors = [], [], []

    for m in BLOCK_RE.finditer(content):
        lang = (m.group(1) or "").lower()
        body = m.group(2)
        lines = body.splitlines()

        path, start = first_annotation(lines, lang)
        if not path:
            skipped.append(lines[0][:60] if lines else "<empty>")
            continue

        # Check if the block contains multiple annotation lines (multi-file block)
        extra = [PATH_RE.match(l) for l in lines[start:] if PATH_RE.match(l)]
        seg_paths = [path] + [e.group(1) for e in extra]

        if len(seg_paths) > 1:
            # multi-file block
            segs = split_multi_file(body)
            for p, seg_lines in segs:
                write_file(p, seg_lines, created, errors)
        else:
            content_lines = lines[start:]
            write_file(path, content_lines, created, errors)

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


def write_file(path, content_lines, created, errors):
    text = "\n".join(content_lines)
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


if __name__ == "__main__":
    main()
