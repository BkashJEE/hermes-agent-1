"""Profile inference settings exposed to Bot Mode group member editors."""

from __future__ import annotations

from pathlib import Path

import yaml

import tui_gateway.server as srv


def _write_config(home, payload):
    (home / "config.yaml").write_text(yaml.safe_dump(payload, sort_keys=False), encoding="utf-8")


def _read_config(home):
    return yaml.safe_load((home / "config.yaml").read_text(encoding="utf-8")) or {}


def test_profiles_describe_and_configure_round_trip_inference_settings(tmp_path, monkeypatch):
    home = tmp_path / ".hermes"
    home.mkdir()
    monkeypatch.setenv("HERMES_HOME", str(home))
    _write_config(
        home,
        {
            "model": {"provider": "anthropic", "default": "claude-old"},
            "agent": {"reasoning_effort": "low", "max_iterations": 77},
            "display": {"theme": "dark"},
        },
    )

    before = srv._methods["profiles.describe"]("describe-before", {"name": "default"})["result"]
    assert before["model"] == {"provider": "anthropic", "default": "claude-old"}
    assert before["reasoning_effort"] == "low"

    configured = srv._methods["profiles.configure"](
        "configure",
        {
            "name": "default",
            "provider": "openai-codex",
            "model": "gpt-5.6",
            "reasoning_effort": "high",
        },
    )["result"]

    assert configured["ok"] is True
    assert configured["applied"] == {"model": True, "reasoning_effort": True}
    saved = _read_config(home)
    assert saved["model"] == {"provider": "openai-codex", "default": "gpt-5.6"}
    assert saved["agent"] == {"reasoning_effort": "high", "max_iterations": 77}
    assert saved["display"] == {"theme": "dark"}

    after = srv._methods["profiles.describe"]("describe-after", {"name": "default"})["result"]
    assert after["model"] == {"provider": "openai-codex", "default": "gpt-5.6"}
    assert after["reasoning_effort"] == "high"


def test_profiles_configure_reconciles_stale_model_endpoint_fields(tmp_path, monkeypatch):
    home = tmp_path / ".hermes"
    home.mkdir()
    monkeypatch.setenv("HERMES_HOME", str(home))
    _write_config(
        home,
        {
            "model": {
                "provider": "anthropic",
                "default": "claude-old",
                "base_url": "https://old-provider.example/v1",
                "context_length": 1234,
            },
            "agent": {"reasoning_effort": "medium"},
        },
    )

    configured = srv._methods["profiles.configure"](
        "configure-provider-switch",
        {
            "name": "default",
            "provider": "openai-codex",
            "model": "gpt-5.6",
            "reasoning_effort": "high",
        },
    )["result"]

    assert configured["ok"] is True
    saved_model = _read_config(home)["model"]
    assert saved_model["provider"] == "openai-codex"
    assert saved_model["default"] == "gpt-5.6"
    assert saved_model["base_url"] == ""
    assert "context_length" not in saved_model


def test_profiles_configure_rejects_invalid_reasoning_without_partial_model_write(tmp_path, monkeypatch):
    home = tmp_path / ".hermes"
    home.mkdir()
    monkeypatch.setenv("HERMES_HOME", str(home))
    original = {
        "model": {"provider": "anthropic", "default": "claude-old"},
        "agent": {"reasoning_effort": "medium"},
        "custom": {"keep": True},
    }
    _write_config(home, original)

    configured = srv._methods["profiles.configure"](
        "configure-invalid",
        {
            "name": "default",
            "provider": "openai-codex",
            "model": "gpt-5.6",
            "reasoning_effort": "impossible",
        },
    )["result"]

    assert configured["ok"] is False
    assert configured["applied"] == {"model": False, "reasoning_effort": False}
    assert configured["errors"]["reasoning_effort"].startswith("Unsupported reasoning effort")
    assert _read_config(home) == original


def test_profiles_configure_reports_incomplete_model_pair_as_model_error(tmp_path, monkeypatch):
    home = tmp_path / ".hermes"
    home.mkdir()
    monkeypatch.setenv("HERMES_HOME", str(home))
    original = {
        "model": {"provider": "anthropic", "default": "claude-old"},
        "agent": {"reasoning_effort": "medium"},
    }
    _write_config(home, original)

    configured = srv._methods["profiles.configure"](
        "configure-incomplete-model",
        {
            "name": "default",
            "provider": "openai-codex",
            "reasoning_effort": "high",
        },
    )["result"]

    assert configured["ok"] is False
    assert configured["applied"] == {"model": False, "reasoning_effort": False}
    assert configured["errors"] == {"model": "Model and provider are required together"}
    assert _read_config(home) == original


def test_profiles_configure_keys_transaction_failure_to_requested_inference_fields(
    tmp_path, monkeypatch
):
    home = tmp_path / ".hermes"
    home.mkdir()
    monkeypatch.setenv("HERMES_HOME", str(home))
    original = {
        "model": {"provider": "anthropic", "default": "claude-old"},
        "agent": {"reasoning_effort": "medium"},
    }
    _write_config(home, original)

    def fail_save(_cfg):
        raise OSError("disk full")

    import hermes_cli.config as config_module

    monkeypatch.setattr(config_module, "save_config", fail_save)
    configured = srv._methods["profiles.configure"](
        "configure-transaction-failure",
        {
            "name": "default",
            "provider": "openai-codex",
            "model": "gpt-5.6",
            "reasoning_effort": "high",
        },
    )["result"]

    assert configured["ok"] is False
    assert configured["applied"] == {"model": False, "reasoning_effort": False}
    assert configured["errors"] == {
        "model": "disk full",
        "reasoning_effort": "disk full",
    }
    assert _read_config(home) == original


def test_profiles_configure_clears_reasoning_override(tmp_path, monkeypatch):
    home = tmp_path / ".hermes"
    home.mkdir()
    monkeypatch.setenv("HERMES_HOME", str(home))
    _write_config(
        home,
        {
            "model": {"provider": "anthropic", "default": "claude-old"},
            "agent": {"reasoning_effort": "high", "max_iterations": 77},
        },
    )

    configured = srv._methods["profiles.configure"](
        "configure-clear-reasoning",
        {"name": "default", "reasoning_effort": ""},
    )["result"]

    assert configured["ok"] is True
    assert configured["applied"] == {"reasoning_effort": True}
    saved = _read_config(home)
    assert "reasoning_effort" not in saved["agent"]
    assert saved["agent"]["max_iterations"] == 77


def test_model_options_scopes_inventory_to_requested_profile(tmp_path, monkeypatch):
    home = tmp_path / ".hermes"
    profile = home / "profiles" / "builder"
    profile.mkdir(parents=True)
    monkeypatch.setattr(Path, "home", lambda: tmp_path)
    monkeypatch.setenv("HERMES_HOME", str(home))

    import hermes_cli.inventory as inventory
    from hermes_constants import get_hermes_home

    monkeypatch.setattr(
        inventory,
        "build_model_options_payload",
        lambda *_args, **_kwargs: {
            "home": str(get_hermes_home()),
            "providers": [],
        },
    )

    result = srv._methods["model.options"](
        "model-options-builder",
        {"profile": "builder", "include_unconfigured": False},
    )["result"]

    assert result["home"] == str(profile)
