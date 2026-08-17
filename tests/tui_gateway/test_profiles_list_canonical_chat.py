"""Regression tests for Bot Mode canonical-chat roster previews."""

from __future__ import annotations

from types import SimpleNamespace

import yaml

from hermes_state import SessionDB
from tui_gateway import server


def _profile(path, *, name="bot"):
    return SimpleNamespace(
        name=name,
        path=path,
        is_default=False,
        model="test-model",
        provider="test-provider",
        description="Test bot description",
        skill_count=0,
    )


def _seed_session(db, session_id, *, title, source, reply):
    db.create_session(session_id, source=source)
    assert db.set_session_title(session_id, title)
    db.append_message(session_id, "assistant", reply)


def _call_profiles_list():
    return server._methods["profiles.list"](1, {"prefer_bot_chat": True})


def test_profiles_list_prefers_bot_mode_canonical_chat(monkeypatch, tmp_path):
    profile_path = tmp_path / "bot"
    profile_path.mkdir()
    (profile_path / "profile.yaml").write_text(
        yaml.safe_dump({"ui_meta": {"hermes-bots": {"chat": "canonical"}}}),
        encoding="utf-8",
    )
    db = SessionDB(profile_path / "state.db")
    try:
        _seed_session(
            db,
            "canonical",
            title="Bot Chat",
            source="desktop",
            reply="Canonical Bot Chat reply",
        )
        _seed_session(
            db,
            "standup",
            title="Daily standup",
            source="cli",
            reply='{"profile":"bot","verified_completed":[]}',
        )
    finally:
        db.close()

    import hermes_cli.profiles as profiles

    monkeypatch.setattr(profiles, "list_profiles", lambda: [_profile(profile_path)])

    response = _call_profiles_list()

    assert "error" not in response, response
    row = response["result"]["profiles"][0]
    assert row["last_session"]["id"] == "canonical"
    assert row["last_session"]["preview"] == "Canonical Bot Chat reply"


def test_profiles_list_does_not_substitute_recent_automation_without_canonical_chat(monkeypatch, tmp_path):
    profile_path = tmp_path / "bot"
    profile_path.mkdir()
    db = SessionDB(profile_path / "state.db")
    try:
        _seed_session(
            db,
            "standup",
            title="Daily standup",
            source="cli",
            reply='{"profile":"bot","verified_completed":[]}',
        )
    finally:
        db.close()

    import hermes_cli.profiles as profiles

    monkeypatch.setattr(profiles, "list_profiles", lambda: [_profile(profile_path)])

    response = _call_profiles_list()

    assert "error" not in response, response
    assert response["result"]["profiles"][0]["last_session"] is None
