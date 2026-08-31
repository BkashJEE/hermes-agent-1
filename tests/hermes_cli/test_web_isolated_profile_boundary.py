"""Fail-closed coverage for the isolated dashboard profile boundary."""

from __future__ import annotations

import contextlib
from pathlib import Path

import pytest

pytest.importorskip("fastapi")
from fastapi.testclient import TestClient  # noqa: E402


@contextlib.contextmanager
def _client(monkeypatch, home: Path, *, isolated: bool = True):
    monkeypatch.setenv("HERMES_HOME", str(home))
    monkeypatch.setenv("HERMES_DASHBOARD_SESSION_TOKEN", "boundary-test-token")
    from hermes_cli import web_server

    old_isolated = getattr(web_server.app.state, "isolated", None)
    old_home = getattr(web_server.app.state, "isolated_home", None)
    had_isolated = hasattr(web_server.app.state, "isolated")
    had_home = hasattr(web_server.app.state, "isolated_home")
    web_server.app.state.isolated = isolated
    web_server.app.state.isolated_home = str(home.resolve()) if isolated else None
    web_server._profiles_routes.get_profiles_sessions_sidebar.cache_clear()
    client = TestClient(web_server.app, raise_server_exceptions=False)
    client.headers["Authorization"] = "Bearer boundary-test-token"
    try:
        with client:
            yield client
    finally:
        web_server._profiles_routes.get_profiles_sessions_sidebar.cache_clear()
        if had_isolated:
            web_server.app.state.isolated = old_isolated
        else:
            delattr(web_server.app.state, "isolated")
        if had_home:
            web_server.app.state.isolated_home = old_home
        else:
            delattr(web_server.app.state, "isolated_home")


@pytest.fixture()
def homes(tmp_path, monkeypatch):
    monkeypatch.setenv("HOME", str(tmp_path))
    root = tmp_path / ".hermes"
    profiles_root = root / "profiles"
    for name in ("alice", "bob", "custom"):
        home = profiles_root / name
        home.mkdir(parents=True)
        (home / "SOUL.md").write_text(f"# {name}\n", encoding="utf-8")
    return root, profiles_root


def test_custom_sentinel_cannot_authorize_named_custom(homes, tmp_path, monkeypatch):
    """An out-of-tree home labelled custom cannot read profiles/custom."""
    _root, profiles_root = homes
    external = tmp_path / "external-hermes-home"
    external.mkdir()

    with _client(monkeypatch, external) as client:
        response = client.get("/api/profiles/custom/soul")
        status = client.get("/api/status", params={"profile": "custom"})

    assert response.status_code == 403, response.text
    assert status.status_code == 403, status.text
    assert (profiles_root / "custom" / "SOUL.md").read_text(encoding="utf-8") == "# custom\n"


def test_missing_pinned_home_fails_closed(homes, monkeypatch):
    """Identity-capture failure never falls back to the real default profile."""
    root, _profiles_root = homes
    from hermes_cli import web_server

    with _client(monkeypatch, root) as client:
        web_server.app.state.isolated_home = None
        response = client.get("/api/profiles/default/soul")
        implicit = client.get("/api/config/raw")
        status = client.get("/api/status")
        action = client.post("/api/gateway/start")

    assert response.status_code == 403, response.text
    assert implicit.status_code == 403, implicit.text
    assert status.status_code == 403, status.text
    assert action.status_code == 403, action.text


def test_implicit_scope_uses_pinned_home_after_live_home_drift(homes, monkeypatch):
    _root, profiles_root = homes
    alice = profiles_root / "alice"
    bob = profiles_root / "bob"
    (alice / "config.yaml").write_text("owner: alice\n", encoding="utf-8")
    (bob / "config.yaml").write_text("owner: bob\n", encoding="utf-8")

    with _client(monkeypatch, alice) as client:
        monkeypatch.setenv("HERMES_HOME", str(bob))
        response = client.get("/api/config/raw")
        status = client.get("/api/status")

    assert response.status_code == 200, response.text
    assert response.json()["yaml"] == "owner: alice\n"
    assert Path(response.json()["path"]).resolve() == (alice / "config.yaml").resolve()
    assert Path(status.json()["config_path"]).resolve() == (alice / "config.yaml").resolve()


def test_implicit_child_action_inherits_pinned_home(homes, monkeypatch):
    _root, profiles_root = homes
    alice = profiles_root / "alice"
    bob = profiles_root / "bob"
    from hermes_cli import web_server

    captured = {}

    class Proc:
        pid = 123

    def spawn(command, name, *, env_overrides=None):
        captured.update(command=command, name=name, env=env_overrides)
        return Proc()

    monkeypatch.setattr(web_server, "_spawn_hermes_action", spawn)
    with _client(monkeypatch, alice) as client:
        monkeypatch.setenv("HERMES_HOME", str(bob))
        response = client.post("/api/gateway/start")

    assert response.status_code == 200, response.text
    assert captured["command"] == ["-p", "alice", "gateway", "start"]
    assert Path(captured["env"]["HERMES_HOME"]).resolve() == alice.resolve()


def test_all_spawned_actions_are_centrally_pinned(homes, tmp_path, monkeypatch):
    _root, profiles_root = homes
    alice = profiles_root / "alice"
    bob = profiles_root / "bob"
    from hermes_cli import web_server

    captured = {}

    class Proc:
        pid = 456

    def popen(command, **kwargs):
        captured.update(command=command, kwargs=kwargs)
        return Proc()

    monkeypatch.setattr(web_server.subprocess, "Popen", popen)
    monkeypatch.setattr(web_server, "_ACTION_LOG_DIR", tmp_path / "actions")
    monkeypatch.setitem(web_server._ACTION_LOG_FILES, "test-action", "test.log")

    with _client(monkeypatch, alice):
        monkeypatch.setenv("HERMES_HOME", str(bob))
        web_server._spawn_hermes_action(
            ["skills", "install", "example"],
            "test-action",
            env_overrides={"HERMES_HOME": str(bob)},
        )

    assert captured["command"][-3:] == ["skills", "install", "example"]
    assert Path(captured["kwargs"]["env"]["HERMES_HOME"]).resolve() == alice.resolve()


def test_status_topology_is_clamped_without_enumerating(homes, monkeypatch):
    _root, profiles_root = homes
    alice = profiles_root / "alice"
    from hermes_cli import profiles as profiles_mod
    from hermes_cli import web_server

    def forbidden(*_args, **_kwargs):
        raise AssertionError("isolated status enumerated sibling profiles")

    monkeypatch.setattr(profiles_mod, "profiles_to_serve", forbidden)
    web_server._TOPOLOGY_CACHE.update({"data": None, "fn": None, "ts": 0.0})
    with _client(monkeypatch, alice) as client:
        response = client.get("/api/status")
    web_server._TOPOLOGY_CACHE.update({"data": None, "fn": None, "ts": 0.0})

    assert response.status_code == 200, response.text
    assert response.json()["profiles"] == ["alice"]


def test_aggregate_reads_are_clamped_without_enumerating(homes, monkeypatch):
    root, profiles_root = homes
    alice = profiles_root / "alice"
    from hermes_cli import profiles as profiles_mod

    def forbidden(*_args, **_kwargs):
        raise AssertionError("isolated aggregate enumerated sibling profiles")

    monkeypatch.setattr(profiles_mod, "list_profiles", forbidden)
    monkeypatch.setattr(profiles_mod, "profiles_to_serve", forbidden)

    with _client(monkeypatch, alice) as client:
        listed = client.get("/api/profiles")
        sessions = client.get("/api/profiles/sessions")
        sidebar = client.get("/api/profiles/sessions/sidebar")
        projects = client.get("/api/profiles/projects/tree")
        prs = client.post("/api/profiles/sessions/pull-requests", json={"ids": ["missing"]})
        active = client.get("/api/profiles/active")
        cron = client.get("/api/cron/jobs")

    for response in (listed, sessions, sidebar, projects, prs, active, cron):
        assert response.status_code == 200, response.text
    assert [item["name"] for item in listed.json()["profiles"]] == ["alice"]
    assert active.json() == {"active": "alice", "current": "alice"}
    assert set(sessions.json()["profile_totals"]) <= {"alice"}
    assert set(sidebar.json()["recents"]["profiles_usage"]) <= {"alice"}


def test_explicit_sibling_selector_is_rejected_before_existence_probe(
    homes, monkeypatch
):
    _root, profiles_root = homes
    alice = profiles_root / "alice"
    from hermes_cli import profiles as profiles_mod

    def forbidden(_name):
        raise AssertionError("profile existence was probed before authorization")

    monkeypatch.setattr(profiles_mod, "profile_exists", forbidden)
    with _client(monkeypatch, alice) as client:
        sessions = client.get("/api/profiles/sessions", params={"profile": "bob"})
        sidebar = client.get(
            "/api/profiles/sessions/sidebar", params={"recents_profile": "bob"}
        )

    assert sessions.status_code == 403, sessions.text
    assert sidebar.status_code == 403, sidebar.text


def test_unified_dashboard_keeps_machine_wide_listing(homes, monkeypatch):
    root, _profiles_root = homes
    with _client(monkeypatch, root, isolated=False) as client:
        response = client.get("/api/profiles")

    assert response.status_code == 200, response.text
    assert {item["name"] for item in response.json()["profiles"]} >= {
        "default",
        "alice",
        "bob",
        "custom",
    }
