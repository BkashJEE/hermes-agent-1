"""Regression coverage for durable stored-session visibility changes."""

from __future__ import annotations

from contextlib import contextmanager

from tui_gateway import server


class FakeSessionDB:
    def __init__(self, existing: set[str]):
        self.existing = existing
        self.calls: list[tuple[str, bool]] = []

    def set_session_hidden(self, session_id: str, hidden: bool) -> bool:
        self.calls.append((session_id, hidden))
        return session_id in self.existing


def test_set_stored_hidden_targets_profile_scoped_db(monkeypatch):
    db = FakeSessionDB({"stored-bot-chat"})
    seen_params: list[dict] = []
    events: list[tuple[str, dict]] = []

    @contextmanager
    def profile_db(params):
        seen_params.append(params)
        yield db

    monkeypatch.setattr(server, "_profile_db", profile_db)
    monkeypatch.setattr(server, "_broadcast_global_event", lambda event, payload: events.append((event, payload)))

    response = server._methods["session.set_stored_hidden"](
        1,
        {"session_id": "stored-bot-chat", "profile": "researcher", "hidden": True},
    )

    assert "error" not in response, response
    assert response["result"] == {"hidden": True, "session_id": "stored-bot-chat"}
    assert db.calls == [("stored-bot-chat", True)]
    assert seen_params == [{"session_id": "stored-bot-chat", "profile": "researcher", "hidden": True}]
    assert events == [("sessions.changed", {})]


def test_set_stored_hidden_rejects_unknown_session(monkeypatch):
    db = FakeSessionDB(set())
    events: list[tuple[str, dict]] = []

    @contextmanager
    def profile_db(_params):
        yield db

    monkeypatch.setattr(server, "_profile_db", profile_db)
    monkeypatch.setattr(server, "_broadcast_global_event", lambda event, payload: events.append((event, payload)))

    response = server._methods["session.set_stored_hidden"](
        2,
        {"session_id": "missing", "hidden": False},
    )

    assert response["error"]["code"] == 4007
    assert db.calls == [("missing", False)]
    assert events == []
