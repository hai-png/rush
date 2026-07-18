#!/usr/bin/env python3
"""Parse docs/fixes.md and create files described in fenced code blocks.

Special handling:
- `// path` / `# path` annotations for ts/tsx/tsx/json/js/md.
- Parenthesized route-group paths `(auth)`.
- "additions" blocks (identityService, adminRoutes, operationsService refactor,
  app.ts corrected mounts) are written to sidecar files so originals aren't clobbered:
    * `.../service.ts — additions (...)` -> `service.additions.ts`
    * `.../routes.ts — additions` -> `routes.additions.ts`
    * `.../app.ts — corrected mounts` -> `app.fixes.ts`
- A block that is purely a prose no-op comment (e.g. "unchanged mount") is skipped.
"""
import os
import re

_BASE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SRC = os.path.join(_BASE, "docs", "fixes.md")
ROOT = _BASE

PATH_RE = re.compile(r"^\s*//\s*([\w./\[\]()-]+\.\w+)\b")
PATH_RE_HASH = re.compile(r"^\s*#\s*([\w./\[\]()-]+\.\w+)\b")


def resolve_path(first_line):
    """Return (path, skip) for a block annotation line."""
    m = PATH_RE.match(first_line) or PATH_RE_HASH.match(first_line)
    if not m:
        return None, False
    path = m.group(1)
    body = first_line.strip()

    # no-op comment block (e.g. "unchanged mount")
    if 'unchanged' in body.lower() or '— unchanged' in body or '-- unchanged' in body:
        return None, True

    # app.ts corrected mounts -> sidecar
    if path.endswith('app.ts') and 'corrected mounts' in body:
        return path.replace('.ts', '.fixes.ts'), False

    # "additions" blocks -> sidecar
    if 'additions' in body or '— additions' in body or '-- additions' in body:
        base, ext = os.path.splitext(path)
        # base like '.../identity/service' -> 'service.additions'
        dirn, fname = os.path.split(base)
        return os.path.join(dirn, f"{fname}.additions{ext}"), False

    return path, False


def main():
    with open(SRC, "r", encoding="utf-8") as f:
        content = f.read()

    created, skipped, errors = [], [], []

    for m in BLOCK_RE.finditer(content):
        lines = m.group(2).splitlines()

        path = None
        start = 0
        skip = False
        for i, line in enumerate(lines):
            s = line.strip()
            if not s:
                continue
            p, sk = resolve_path(line)
            if p or sk:
                path, skip = p, sk
                start = i + 1
            break

        if skip:
            skipped.append(lines[0][:60] if lines else "<empty>")
            continue
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
        print(f"\nSkipped {len(skipped)} blocks:")
        for s in skipped:
            print(f"  - {s}")
    if errors:
        print(f"\nErrors ({len(errors)}):")
        for p, e in errors:
            print(f"  ! {p}: {e}")
        raise SystemExit(1)


BLOCK_RE = re.compile(r"```(\w+)?\n(.*?)```", re.DOTALL)

if __name__ == "__main__":
    main()
