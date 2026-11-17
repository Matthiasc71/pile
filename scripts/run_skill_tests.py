#!/usr/bin/env python3
"""Run the vendored day-trader-skill test suite, minus test_repo.py.

test_repo.py checks the upstream repository's own layout (README.md and
.claude-plugin/ at its root), which by design does not exist once the eleven
folders are copied into .claude/skills/. Every functional test runs.
"""

import os
import sys
import unittest

TESTS = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".claude", "skills", "tests"))
SKIP_MODULES = {"test_repo"}


def flatten(suite):
    for item in suite:
        if isinstance(item, unittest.TestSuite):
            yield from flatten(item)
        else:
            yield item


def main():
    sys.path.insert(0, TESTS)
    found = unittest.TestLoader().discover(TESTS, pattern="test_*.py", top_level_dir=TESTS)
    kept = unittest.TestSuite(t for t in flatten(found) if type(t).__module__ not in SKIP_MODULES)
    print("day-trader-skill tests: %d (skipping %s)" % (kept.countTestCases(), ", ".join(sorted(SKIP_MODULES))))
    result = unittest.TextTestRunner(verbosity=1).run(kept)
    return 0 if result.wasSuccessful() else 1


if __name__ == "__main__":
    sys.exit(main())
