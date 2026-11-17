#!/usr/bin/env python3
"""Rule 0.5: the vendored day-trader-skill stays byte for byte as upstream.

    python3 scripts/skill_integrity.py record   # once, right after vendoring
    python3 scripts/skill_integrity.py verify   # CI: fails on any change

The manifest lists every file under the eleven trader-* folders and the
skill's tests/, with its SHA-256. A file added, removed or edited fails.
"""

import hashlib
import os
import sys

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
SKILLS = os.path.join(ROOT, ".claude", "skills")
MANIFEST = os.path.join(SKILLS, "TRADER_SHA256SUMS")
FOLDERS = ["trader-alerts", "trader-analyst", "trader-broker", "trader-budget", "trader-entry",
           "trader-exit", "trader-news", "trader-pelosi", "trader-risk", "trader-scanner",
           "trader-timemachine", "tests"]
EXTRA = ["LICENSE-day-trader-skill"]


def current():
    sums = {}
    for folder in FOLDERS:
        base = os.path.join(SKILLS, folder)
        if not os.path.isdir(base):
            continue
        for d, dirs, files in os.walk(base):
            dirs[:] = sorted(x for x in dirs if x != "__pycache__")
            for f in sorted(files):
                if f.endswith(".pyc"):
                    continue
                p = os.path.join(d, f)
                sums[os.path.relpath(p, SKILLS).replace(os.sep, "/")] = _sha(p)
    for f in EXTRA:
        p = os.path.join(SKILLS, f)
        if os.path.isfile(p):
            sums[f] = _sha(p)
    return sums


def _sha(path):
    h = hashlib.sha256()
    with open(path, "rb") as fh:
        for chunk in iter(lambda: fh.read(65536), b""):
            h.update(chunk)
    return h.hexdigest()


def read_manifest():
    sums = {}
    with open(MANIFEST, encoding="utf-8") as fh:
        for line in fh:
            line = line.rstrip("\n")
            if line and not line.startswith("#"):
                digest, path = line.split("  ", 1)
                sums[path] = digest
    return sums


def main(argv):
    cmd = argv[1] if len(argv) > 1 else "verify"
    if cmd == "record":
        sums = current()
        with open(MANIFEST, "w", encoding="utf-8") as fh:
            fh.write("# day-trader-skill 3d0f4ef, vendored unmodified. Checked by scripts/skill_integrity.py\n")
            for path in sorted(sums):
                fh.write("%s  %s\n" % (sums[path], path))
        print("Recorded %d files." % len(sums))
        return 0
    if cmd != "verify":
        print(__doc__)
        return 2
    want, have = read_manifest(), current()
    missing = sorted(set(want) - set(have))
    added = sorted(set(have) - set(want))
    changed = sorted(p for p in set(want) & set(have) if want[p] != have[p])
    if missing or added or changed:
        print("Skill integrity FAILED (rule 0.5: never edit the skill's files).")
        for label, items in (("missing", missing), ("added", added), ("changed", changed)):
            for p in items:
                print("  %s: %s" % (label, p))
        return 1
    print("Skill integrity OK: %d files match upstream 3d0f4ef." % len(want))
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))
