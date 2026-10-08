"""Tests for the bot-forge-sentinel plugin.

Covers ``plugins/bot-forge-sentinel/``:

  * ``guard.decide`` precedence — refuse > ask > allow, and the built-in categories
    underneath them.
  * Name matching on word parts rather than substrings, so ``undelete_draft`` is not a
    delete and ``posture_report`` is not a post.
  * Failing closed — an unreadable policy, a malformed one, or a ``get_config`` that
    raises all produce a block carrying the reason, never silence.
  * Directive shape — every directive uses an action the ``pre_tool_call`` dispatcher
    acts on, and a block always carries the message that becomes the tool result.
  * Bundled-plugin discovery — the manifest declares exactly the hooks ``register``
    registers, and the plugin grants no tools.
"""

import importlib.util
import sys
import types
from pathlib import Path

import pytest


@pytest.fixture(autouse=True)
def _isolate_env(tmp_path, monkeypatch):
    hermes_home = tmp_path / ".hermes"
    hermes_home.mkdir()
    monkeypatch.setenv("HERMES_HOME", str(hermes_home))
    yield hermes_home


# ---------------------------------------------------------------------------
# Module loading
# ---------------------------------------------------------------------------

def _repo_root() -> Path:
    return Path(__file__).resolve().parents[2]


def _plugin_dir() -> Path:
    return _repo_root() / "plugins" / "bot-forge-sentinel"


def _load_guard():
    """Import guard.py in isolation (no plugin glue)."""
    spec = importlib.util.spec_from_file_location(
        "bot_forge_sentinel_guard_under_test", _plugin_dir() / "guard.py"
    )
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


def _load_plugin_init():
    """Import the plugin __init__.py as a package, with guard.py as a sibling."""
    plugin_dir = _plugin_dir()
    if "hermes_plugins" not in sys.modules:
        ns = types.ModuleType("hermes_plugins")
        ns.__path__ = []
        sys.modules["hermes_plugins"] = ns
    spec = importlib.util.spec_from_file_location(
        "hermes_plugins.bot_forge_sentinel",
        plugin_dir / "__init__.py",
        submodule_search_locations=[str(plugin_dir)],
    )
    mod = importlib.util.module_from_spec(spec)
    mod.__package__ = "hermes_plugins.bot_forge_sentinel"
    mod.__path__ = [str(plugin_dir)]
    sys.modules["hermes_plugins.bot_forge_sentinel"] = mod
    spec.loader.exec_module(mod)
    return mod


class _Ctx:
    """A plugin context that records hooks and serves a policy."""

    def __init__(self, config=None, raises=False):
        self.config = config or {}
        self.raises = raises
        self.hooks = {}

    def get_config(self, key, default=None):
        if self.raises:
            raise RuntimeError("config unavailable")
        return self.config.get(key, default)

    def register_hook(self, name, callback):
        self.hooks[name] = callback

    def register_tool(self, **kwargs):  # pragma: no cover - must never be called
        raise AssertionError("a policy layer must not grant the agent tools")


# ---------------------------------------------------------------------------
# Precedence
# ---------------------------------------------------------------------------

class TestPrecedence:
    def test_refuse_beats_ask_and_allow(self):
        guard = _load_guard()
        policy = {"refuse": ["send_email"], "ask": ["send_email"], "allow": ["send_email"]}
        assert guard.decide("send_email", policy)["action"] == "block"

    def test_ask_beats_allow(self):
        guard = _load_guard()
        policy = {"ask": ["send_email"], "allow": ["send_email"]}
        assert guard.decide("send_email", policy)["action"] == "approve"

    def test_allow_clears_a_tool_that_looks_like_a_category(self):
        guard = _load_guard()
        assert guard.decide("post_update", {"allow": ["post_update"]}) is None

    def test_an_unlisted_tool_is_left_alone_by_default(self):
        guard = _load_guard()
        assert guard.decide("read_file", {}) is None


# ---------------------------------------------------------------------------
# Name matching
# ---------------------------------------------------------------------------

class TestNameMatching:
    @pytest.mark.parametrize(
        "tool",
        ["send_email", "post_tweet", "publish_page", "buy_item", "transfer_funds",
         "delete_file", "purge_cache"],
    )
    def test_each_category_reaches_the_human_gate(self, tool):
        guard = _load_guard()
        assert guard.decide(tool, {})["action"] == "approve"

    @pytest.mark.parametrize(
        "tool",
        ["undelete_draft", "posture_report", "spendable_budget_report", "repost_count",
         "deleted_items_count"],
    )
    def test_a_word_inside_another_word_is_not_a_match(self, tool):
        """Substring matching would catch all of these. Word parts do not."""
        guard = _load_guard()
        assert guard.decide(tool, {}) is None

    @pytest.mark.parametrize("tool", ["send-email", "mail.send", "SEND_EMAIL", "Post_Tweet"])
    def test_separators_and_case_do_not_hide_a_category(self, tool):
        guard = _load_guard()
        assert guard.decide(tool, {})["action"] == "approve"

    def test_defaults_can_be_off_while_explicit_rules_still_apply(self):
        guard = _load_guard()
        assert guard.decide("send_email", {"guard_defaults": False}) is None
        policy = {"guard_defaults": False, "refuse": ["send_email"]}
        assert guard.decide("send_email", policy)["action"] == "block"

    def test_ask_mode_gates_everything_not_cleared(self):
        guard = _load_guard()
        assert guard.decide("read_file", {"mode": "ask"})["action"] == "approve"
        assert guard.decide("read_file", {"mode": "ask", "allow": ["read_file"]}) is None


# ---------------------------------------------------------------------------
# Failing closed
# ---------------------------------------------------------------------------

class TestFailsClosed:
    @pytest.mark.parametrize("policy", [None, "not a mapping", 42, []])
    def test_an_unreadable_policy_refuses(self, policy):
        guard = _load_guard()
        out = guard.decide("read_file", policy)
        assert out["action"] == "block"
        assert "could not be read" in out["message"]

    def test_a_block_always_carries_a_message(self):
        """A block with no message is dropped by the dispatcher — a silent permit."""
        guard = _load_guard()
        out = guard.decide("delete_profile", {"refuse": ["delete_profile"]})
        assert out["message"].strip()

    @pytest.mark.parametrize("tool", ["", "   ", None, 7])
    def test_a_nameless_tool_is_abstained_on_rather_than_guessed(self, tool):
        guard = _load_guard()
        assert guard.decide(tool, {}) is None

    def test_a_config_that_raises_refuses_rather_than_permits(self):
        mod = _load_plugin_init()
        ctx = _Ctx(raises=True)
        mod.register(ctx)
        out = ctx.hooks["pre_tool_call"](tool_name="send_email", args={})
        assert out["action"] == "block"
        assert "could not be read" in out["message"]


# ---------------------------------------------------------------------------
# Directive shape
# ---------------------------------------------------------------------------

class TestDirectiveShape:
    def test_approve_keys_its_always_rule_per_tool(self):
        guard = _load_guard()
        assert guard.decide("send_email", {})["rule_key"] == "bot-forge-sentinel:send_email"

    def test_always_allowing_one_tool_does_not_clear_its_category(self):
        guard = _load_guard()
        assert guard.decide("send_email", {})["rule_key"] != guard.decide("post_tweet", {})["rule_key"]

    def test_every_directive_uses_an_action_the_dispatcher_acts_on(self):
        guard = _load_guard()
        seen = set()
        for tool, policy in [("send_email", {}), ("x", {"refuse": ["x"]}),
                             ("y", {"ask": ["y"]}), ("z", None)]:
            out = guard.decide(tool, policy)
            assert out["action"] in ("block", "approve")
            seen.add(out["action"])
        assert seen == {"block", "approve"}


# ---------------------------------------------------------------------------
# The hook
# ---------------------------------------------------------------------------

class TestHook:
    def test_it_returns_a_directive_from_the_profile_policy(self):
        mod = _load_plugin_init()
        ctx = _Ctx({"refuse": ["delete_profile"]})
        mod.register(ctx)
        assert ctx.hooks["pre_tool_call"](tool_name="delete_profile", args={})["action"] == "block"

    def test_it_tolerates_the_full_kwargs_the_dispatcher_sends(self):
        mod = _load_plugin_init()
        ctx = _Ctx()
        mod.register(ctx)
        out = ctx.hooks["pre_tool_call"](
            tool_name="send_email", args={"to": "x"}, task_id="t", session_id="s",
            tool_call_id="c", turn_id=1, api_request_id="a", middleware_trace=[],
        )
        assert out["action"] == "approve"


# ---------------------------------------------------------------------------
# Bundled-plugin discovery
# ---------------------------------------------------------------------------

class TestPluginDiscovery:
    def test_manifest_declares_registered_hooks(self):
        """Manifest metadata must use the field consumed by plugin discovery."""
        import hermes_yaml as yaml

        manifest = yaml.safe_load((_plugin_dir() / "plugin.yaml").read_text(encoding="utf-8"))
        mod = _load_plugin_init()
        registered = []

        class HookContext:
            def register_hook(self, name, _callback):
                registered.append(name)

        mod.register(HookContext())
        assert set(manifest["provides_hooks"]) == set(registered)
        assert "hooks" not in manifest

    def test_it_grants_no_tools(self):
        """A policy layer that widened the agent's reach would defeat its own purpose."""
        import hermes_yaml as yaml

        manifest = yaml.safe_load((_plugin_dir() / "plugin.yaml").read_text(encoding="utf-8"))
        assert not manifest.get("provides_tools")
        mod = _load_plugin_init()
        mod.register(_Ctx())  # _Ctx.register_tool raises if it is ever called

    def test_every_config_key_declares_a_type_and_description(self):
        import hermes_yaml as yaml

        manifest = yaml.safe_load((_plugin_dir() / "plugin.yaml").read_text(encoding="utf-8"))
        for key, entry in manifest["config_schema"].items():
            assert "type" in entry, key
            assert "description" in entry, key
