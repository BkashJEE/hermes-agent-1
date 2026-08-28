"""Full-repo self-scan wrapper for scripts/check-windows-footguns.py.

scripts/check_subprocess_stdin.py has had a pytest wrapper (see
tests/tools/test_subprocess_stdin_guard.py's test_all_tui_subprocess_calls_
have_stdin) that runs the checker with its default full-scan behavior and
asserts a clean exit — so a normal pytest run of that file catches
regressions even when no one remembers to run the standalone script by hand.
check-windows-footguns.py had no equivalent: only a narrow rule-level test
(tests/scripts/test_footgun_subprocess_encoding.py, scoped to the
text=True/encoding= rule) existed, so a bare ``os.killpg``/``signal.SIGKILL``
regression (caught by CI running the real script with --all, not by any
local pytest run) shipped in the T1-T3 npx-agent-browser hardening commit
before anyone ran the script directly. This closes that gap the same way
the stdin guard already closes its equivalent one.
"""

from __future__ import annotations

import importlib.util
import subprocess
import sys
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[2]
SCRIPT = REPO_ROOT / "scripts" / "check-windows-footguns.py"


def _load_checker():
    """Import the hyphenated script as a module.

    Registered in sys.modules before exec_module because @dataclass resolves
    its class's __module__ through sys.modules while the class body runs.
    """
    spec = importlib.util.spec_from_file_location("_windows_footgun_checker", SCRIPT)
    module = importlib.util.module_from_spec(spec)
    sys.modules[spec.name] = module
    try:
        spec.loader.exec_module(module)
    except Exception:
        sys.modules.pop(spec.name, None)
        raise
    return module


def test_full_repo_scan_has_no_unsuppressed_windows_footguns():
    """Mirrors check_subprocess_stdin.py's wrapper: run the real checker
    against the whole repo (--all) and require a clean exit, so this test
    file — not just institutional memory — is what catches the next
    bare os.killpg/signal.SIGKILL-style regression."""
    result = subprocess.run(
        [sys.executable, str(SCRIPT), "--all"],
        capture_output=True,
        text=True,
        timeout=60,
        stdin=subprocess.DEVNULL,
    )
    assert result.returncode == 0, (
        f"Windows footgun check failed:\n{result.stdout}\n{result.stderr}"
    )


def test_full_scan_reaches_packages_outside_the_old_hardcoded_list():
    """--all must walk the repo, not a hand-maintained package list.

    Until this was fixed, --all scanned eight named directories
    (hermes_cli, gateway, tools, cron, agent, plugins, scripts,
    acp_adapter). Everything else — tui_gateway/ among them — was invisible,
    so the blocking CI job above reported a clean tree for code it had never
    opened, and a live os.kill(pid, 0) sat in tui_gateway/host_supervisor.py
    (#97019) while this very test passed. Assert the walk reaches packages
    the old list omitted so the coverage gap cannot silently return.
    """
    checker = _load_checker()
    roots = {p.name for p in checker.full_scan_roots()}

    for package in (
        "tui_gateway",
        "evals",
        "providers",
        "skills",
        "hermes_cli",
        "gateway",
    ):
        if (REPO_ROOT / package).is_dir():
            assert package in roots, f"--all no longer reaches {package}/"

    # Top-level modules were invisible to the old directory-only list too.
    if (REPO_ROOT / "cli.py").is_file():
        assert "cli.py" in roots


def test_full_scan_skips_only_the_documented_directories():
    """Skips stay narrow and declared — no silent additions."""
    checker = _load_checker()
    roots = {p.name for p in checker.full_scan_roots()}

    assert checker.FULL_SCAN_SKIP_DIRS == {"tests"}
    assert "tests" not in roots, (
        "tests/ is skipped by the sweep, per FULL_SCAN_SKIP_DIRS"
    )
    assert ".git" not in roots
    for excluded in checker.EXCLUDED_DIRS:
        assert excluded not in roots


def test_named_paths_still_scan_skipped_directories():
    """--all skipping tests/ must not make the checker blind to it.

    Staged/diff/explicit-path runs still cover tests, so a footgun added to a
    test is caught at review time even though the sweep walks past it.
    """
    checker = _load_checker()
    tests_dir = REPO_ROOT / "tests"
    if not tests_dir.is_dir():
        return
    scanned = any(True for _ in checker.iter_files([tests_dir]))
    assert scanned, "explicitly naming tests/ must still scan it"
