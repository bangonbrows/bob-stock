#!/usr/bin/env python3
"""
Phase 3 Day 3: Patch index.html to integrate Dexie-based db.js and sync.js
- Adds <script> tags for Dexie CDN, db.js, sync.js
- Comments out inline Sync object definition
- Comments out inline DB object definition
- Wraps App.init() startup in async initDB(SEED) call
"""
import re
import sys

def find_object_end(text, start_pos):
    """Find the matching closing '};' for an object starting with '{'."""
    depth = 0
    i = text.index('{', start_pos)
    while i < len(text):
        ch = text[i]
        if ch == '{':
            depth += 1
        elif ch == '}':
            depth -= 1
            if depth == 0:
                # Look for the semicolon
                j = i + 1
                while j < len(text) and text[j] in ' \t\r\n':
                    j += 1
                if j < len(text) and text[j] == ';':
                    return j + 1  # include the semicolon
                return i + 1
        # Skip string literals
        elif ch in ('"', "'", '`'):
            quote = ch
            i += 1
            while i < len(text) and text[i] != quote:
                if text[i] == '\\':
                    i += 1  # skip escaped char
                i += 1
        # Skip single-line comments
        elif ch == '/' and i + 1 < len(text) and text[i + 1] == '/':
            while i < len(text) and text[i] != '\n':
                i += 1
            continue
        # Skip multi-line comments
        elif ch == '/' and i + 1 < len(text) and text[i + 1] == '*':
            i += 2
            while i + 1 < len(text) and not (text[i] == '*' and text[i + 1] == '/'):
                i += 1
            i += 1  # skip past '/'
        i += 1
    return -1

def main():
    path = 'index.html'
    with open(path, 'r', encoding='utf-8') as f:
        html = f.read()

    original_len = len(html)
    print(f"Read {path}: {original_len} bytes, {html.count(chr(10))} lines")

    # ── Step 1: Add script tags before the first big <script> block ──
    # Find the right place: after the last <link> or <style> in <head>,
    # or just before the first <script> that contains app code.
    # We'll insert just before the script block that contains 'const SEED'

    # Find the script tag that contains the SEED data
    seed_script_match = re.search(r'<script[^>]*>\s*\n\s*(const SEED|var SEED|let SEED)', html)
    if seed_script_match:
        insert_pos = seed_script_match.start()
        print(f"Found SEED script at position {insert_pos}")
    else:
        # Fallback: insert before the first <script> in body
        body_match = re.search(r'<body[^>]*>', html)
        if body_match:
            # Find first script after body
            first_script = html.find('<script', body_match.end())
            insert_pos = first_script
        else:
            print("ERROR: Could not find insertion point for script tags")
            sys.exit(1)

    script_tags = """    <!-- Phase 3: Dexie.js + external DB/Sync modules -->
    <script src="https://unpkg.com/dexie/dist/dexie.js"></script>
    <script src="./db.js"></script>
    <script src="./sync.js"></script>

"""
    html = html[:insert_pos] + script_tags + html[insert_pos:]
    print(f"Inserted script tags at position {insert_pos}")

    # ── Step 2: Comment out inline Sync object ──
    # Look for 'const Sync = {' or 'var Sync = {' in the main script block
    sync_match = re.search(r'\n(\s*)(const|var|let)\s+Sync\s*=\s*\{', html)
    if sync_match:
        sync_start = sync_match.start() + 1  # skip the leading newline
        sync_end = find_object_end(html, sync_match.start())
        if sync_end > 0:
            sync_block = html[sync_start:sync_end]
            # Wrap in a multi-line comment
            commented = sync_match.group(1) + '/* PHASE3_DISABLED: Sync object now loaded from sync.js\n' + sync_block + '\n' + sync_match.group(1) + 'PHASE3_DISABLED */'
            html = html[:sync_start] + commented + html[sync_end:]
            print(f"Commented out inline Sync object ({sync_end - sync_start} chars)")
        else:
            print("WARNING: Could not find end of Sync object")
    else:
        print("INFO: No inline Sync object found (may already be external)")

    # ── Step 3: Comment out inline DB object ──
    # Must re-search because positions shifted after Step 2
    db_match = re.search(r'\n(\s*)(const|var|let)\s+DB\s*=\s*\{', html)
    if db_match:
        db_start = db_match.start() + 1
        db_end = find_object_end(html, db_match.start())
        if db_end > 0:
            db_block = html[db_start:db_end]
            commented = db_match.group(1) + '/* PHASE3_DISABLED: DB object now loaded from db.js\n' + db_block + '\n' + db_match.group(1) + 'PHASE3_DISABLED */'
            html = html[:db_start] + commented + html[db_end:]
            print(f"Commented out inline DB object ({db_end - db_start} chars)")
        else:
            print("WARNING: Could not find end of DB object")
    else:
        print("INFO: No inline DB object found (may already be external)")

    # ── Step 4: Wrap App.init() in async initDB(SEED) ──
    # Find the App.init() call in the startup code
    # Common patterns: 'App.init();' or 'App.init()' at the end of a script block

    # Look for the pattern where App.init() is called
    init_match = re.search(r'(\s*)App\.init\(\);', html)
    if init_match:
        old_init = init_match.group(0)
        indent = init_match.group(1)
        new_init = f"""{indent}// Phase 3: Initialize Dexie DB before app startup
{indent}(async () => {{
{indent}  await initDB(SEED);
{indent}  App.init();
{indent}  await Sync.init();
{indent}  // Listen for service worker sync-push messages
{indent}  if (navigator.serviceWorker) {{
{indent}    navigator.serviceWorker.addEventListener('message', (event) => {{
{indent}      if (event.data && event.data.type === 'sync-push') Sync.push();
{indent}    }});
{indent}  }}
{indent}}})();"""
        html = html.replace(old_init, new_init, 1)
        print("Wrapped App.init() in async initDB(SEED) + Sync.init()")
    else:
        print("WARNING: Could not find App.init() call")

    # ── Step 5: Write the modified file ──
    with open(path, 'w', encoding='utf-8') as f:
        f.write(html)

    new_len = len(html)
    print(f"\nDone! {path}: {original_len} → {new_len} bytes (delta: {new_len - original_len:+d})")

if __name__ == '__main__':
    main()
