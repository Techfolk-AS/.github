"""Exercise the workflow's actual shell block with a fake GitHub CLI."""

import os
from pathlib import Path
import subprocess
import tempfile
import textwrap


workflow = Path(__file__).resolve().parents[1] / ".github/workflows/sync-all-team.yml"
script = textwrap.dedent(workflow.read_text().split("        run: |\n", 1)[1])
mock = """#!/usr/bin/env python3
import os, sys
args = sys.argv[1:]
with open('calls', 'a') as log:
    log.write(' '.join(args) + '\\n')
if '--method' in args:
    assert args == ['api', '--method', 'PUT',
        'orgs/Techfolk-AS/teams/all/memberships/newcomer', '-f', 'role=member', '--silent']
    sys.exit(1 if os.environ['CASE'] == 'write-failure' else 0)
assert '--paginate' in args and 'per_page=100&role=all' in args[2]
assert args[-2:] == ['--jq', '.[].login | ascii_downcase']
team = '/teams/' in args[2]
if os.environ['CASE'] == ('team-failure' if team else 'org-failure'):
    print('partial-result')
    sys.exit(1)
print('maintainer\\nexisting' if team or os.environ['CASE'] == 'synced'
      else 'newcomer\\nmaintainer\\nexisting\\nnewcomer')
"""

for case in ("missing", "synced", "org-failure", "team-failure", "write-failure", "no-token"):
    with tempfile.TemporaryDirectory() as directory:
        root = Path(directory)
        (root / "gh").write_text(mock)
        (root / "gh").chmod(0o755)
        env = dict(os.environ, PATH=f"{root}:{os.environ['PATH']}", CASE=case,
                   GH_TOKEN="" if case == "no-token" else "fake",
                   GITHUB_STEP_SUMMARY=str(root / "summary"))
        result = subprocess.run(["bash", "-c", script], cwd=root, env=env,
                                capture_output=True, text=True)
        assert (result.returncode == 0) == (case in ("missing", "synced")), result.stderr
        calls = (root / "calls").read_text() if (root / "calls").exists() else ""
        writes = [line for line in calls.splitlines() if '--method PUT' in line]
        assert len(writes) == (1 if case in ("missing", "write-failure") else 0), calls
        if case in ("missing", "synced"):
            count = 1 if case == "missing" else 0
            assert f"Added {count} missing" in (root / "summary").read_text()
        else:
            assert not (root / "summary").exists()

print("Team sync checks passed (missing/synced members, read/write failures, missing token).")
