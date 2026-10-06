"""``computer_use.cursor_motion`` → ``set_agent_cursor_motion`` after ``start_session``.

cua-driver 0.34 (trycua/cua#4659) added six agent-cursor motion styles plus timing and effect knobs,
set per session. Hermes applies the configured motion once the session is declared, so every run and
subagent cursor moves the configured way. The config is validated here — cua-driver rejects the whole
call on one bad field, which would silently leave the cursor on the default — and the call is best
effort like the other post-handshake tuning.
"""

from unittest.mock import MagicMock, patch

import pytest

from tools.computer_use import cua_backend


def _parse(value):
    with patch("hermes_cli.config.load_config", return_value={"computer_use": {"cursor_motion": value}}):
        return cua_backend._computer_use_cursor_motion()


class TestConfigParsing:
    def test_unset_is_none(self):
        assert _parse(None) is None
        assert _parse("") is None

    def test_bare_string_is_a_style(self):
        assert _parse("comet_swoop") == {"style": "comet_swoop"}

    def test_full_mapping(self):
        out = _parse({"style": "magnetic", "timing": "fitts", "effects": ["trail", "glow"]})
        assert out == {"style": "magnetic", "timing": "fitts", "effects": {"trail": True, "glow": True}}

    def test_effects_mapping_keeps_explicit_off(self):
        out = _parse({"effects": {"trail": True, "ripple": False}})
        assert out == {"effects": {"trail": True, "ripple": False}}

    def test_unknown_style_dropped_not_sent(self, caplog):
        assert _parse("wobble") is None
        assert _parse({"style": "wobble", "timing": "fitts"}) == {"timing": "fitts"}
        assert "wobble" in caplog.text

    def test_unknown_timing_and_effect_dropped(self, caplog):
        out = _parse({"style": "classic", "timing": "warp", "effects": ["trail", "sparkles"]})
        assert out == {"style": "classic", "effects": {"trail": True}}
        assert "warp" in caplog.text and "sparkles" in caplog.text

    def test_wrong_type_ignored(self, caplog):
        assert _parse(["comet_swoop"]) is None
        assert "cursor_motion" in caplog.text

    def test_every_documented_style_passes(self):
        for style in cua_backend.CURSOR_MOTION_STYLES:
            assert _parse(style) == {"style": style}


class TestStartApplies:
    def _started_backend(self):
        backend = cua_backend.CuaDriverBackend()
        backend._session = MagicMock()
        backend._session.start = MagicMock()
        backend._session._started = True
        backend._session.supports_capability = lambda cap, tool=None: False
        backend._session.supports_input_property = lambda tool, prop: False
        backend._session.call_tool = MagicMock(return_value={
            "data": "", "images": [], "image_mime_types": [], "structuredContent": None, "isError": False,
        })
        return backend

    def _start(self, backend, config):
        with patch("tools.computer_use.cua_backend.cua_driver_runtime_contract_status", return_value={"ready": True}), \
                patch("pm.ensure"), patch("pm.ensure_import"), \
                patch("hermes_cli.config.load_config", return_value={"computer_use": config}):
            backend.start()
        return [(c.args[0], c.args[1]) for c in backend._session.call_tool.call_args_list]

    def test_motion_sent_after_start_session_with_session_id(self):
        backend = self._started_backend()
        calls = self._start(backend, {"cursor_motion": "comet_swoop", "no_overlay": False})
        names = [n for n, _ in calls]
        assert names.index("start_session") < names.index("set_agent_cursor_motion")
        args = dict(calls)["set_agent_cursor_motion"]
        assert args["style"] == "comet_swoop"
        assert args["session"] == backend._session_id

    def test_not_sent_when_unset(self):
        backend = self._started_backend()
        calls = self._start(backend, {"no_overlay": False})
        assert "set_agent_cursor_motion" not in [n for n, _ in calls]

    def test_not_sent_when_overlay_off(self):
        backend = self._started_backend()
        calls = self._start(backend, {"cursor_motion": "magnetic", "no_overlay": True})
        names = [n for n, _ in calls]
        assert "set_agent_cursor_enabled" in names
        assert "set_agent_cursor_motion" not in names

    def test_old_driver_rejection_is_non_fatal(self):
        backend = self._started_backend()

        def call_tool(name, args, **kw):
            if name == "set_agent_cursor_motion":
                raise RuntimeError("Unknown tool: set_agent_cursor_motion")
            return {"data": "", "images": [], "image_mime_types": [], "structuredContent": None, "isError": False}

        backend._session.call_tool = MagicMock(side_effect=call_tool)
        self._start(backend, {"cursor_motion": "spring_settle", "no_overlay": False})  # must not raise


def test_default_config_has_cursor_motion_unset():
    from hermes_cli.config_defaults import DEFAULT_CONFIG
    assert DEFAULT_CONFIG["computer_use"]["cursor_motion"] is None
