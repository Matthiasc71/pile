#!/usr/bin/env python3
"""Paper lock (rule 0.1): fail if the live Alpaca trading host appears anywhere.

The only Alpaca trading host Pile may ever name is the paper one. Any mention
of the trading API host that is not immediately preceded by "paper-" fails the
check, in every tracked file, with no exemption: this script and its test
build the forbidden string from pieces so they never contain it.

Usage: python3 scripts/check_paper_lock.py [ROOT]
Exit 0 when clean, 1 with the offending file:line list otherwise.
"""

import os
import re
import subprocess
import sys

HOST = "api" + r"\." + "alpaca" + r"\." + "markets"
# "paper-api.alpaca.markets" is the only allowed form. Anything else that ends
# in the trading host (bare, "broker-", "www.", "x-") is refused.
PATTERN = re.compile(r"(?<![A-Za-z0-9.-])(?:(?!paper-)[A-Za-z0-9-]+[.-])?" + HOST, re.IGNORECASE)
ALLOWED = re.compile(r"(?<![A-Za-z0-9.-])paper-" + HOST + r"(?![A-Za-z0-9-])", re.IGNORECASE)

SKIP_DIRS = {".git", "node_modules", "dist", ".wrangler", "coverage", "__pycache__"}


def tracked_files(root):
    """Files git tracks plus untracked ones not ignored; walk the tree if git is absent."""
    try:
        out = subprocess.run(
            ["git", "-C", root, "ls-files", "-z", "--cached", "--others", "--exclude-standard"],
            capture_output=True, check=True,
        ).stdout
        return [os.path.join(root, p) for p in out.decode("utf-8", "replace").split("\0") if p]
    except (OSError, subprocess.CalledProcessError):
        found = []
        for d, dirs, files in os.walk(root):
            dirs[:] = [x for x in dirs if x not in SKIP_DIRS]
            found.extend(os.path.join(d, f) for f in files)
        return found


def offences(text):
    """(line number, matched text) for every forbidden mention in text."""
    bad = []
    for n, line in enumerate(text.splitlines(), 1):
        for m in PATTERN.finditer(line):
            if not ALLOWED.fullmatch(m.group(0)):
                bad.append((n, m.group(0)))
    return bad


def scan(root):
    hits = []
    for path in tracked_files(root):
        try:
            with open(path, "rb") as fh:
                raw = fh.read()
        except OSError:
            continue
        if b"\0" in raw[:8192]:
            # binary: still search the raw bytes, decoded loosely
            text = raw.decode("latin-1")
        else:
            text = raw.decode("utf-8", "replace")
        for n, found in offences(text):
            hits.append((os.path.relpath(path, root), n, found))
    return hits


def main(argv):
    root = os.path.abspath(argv[1] if len(argv) > 1 else os.path.join(os.path.dirname(__file__), ".."))
    hits = scan(root)
    if hits:
        print("Paper lock: the live Alpaca trading host must never appear (rule 0.1).")
        for path, n, found in hits:
            print("  %s:%d: %s" % (path, n, found))
        return 1
    print("Paper lock OK: only the paper trading host is named.")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))
