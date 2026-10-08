# bot-forge-sentinel

What an agent may actually do, decided outside the model.

## Why

An agent's approval rules normally live in its `SOUL.md` — Bot Forge's `create_agent`
writes them there, and people write them by hand:

```
## Ask first
- send, post or publish anything
- spend money or buy anything
- delete files or data
```

That is prose in a system prompt. Nothing checks it, and a Bot that ignores it meets no
obstacle and leaves no record.

That is tolerable while an agent writes files and answers questions. It stops being tolerable
once one has `computer_use` and `browser` — a real desktop and a real browser session,
including whatever the user signed into — or once one agent can hand work to another, which
then acts on instructions it never got from the user.

Sentinel turns those three lines into directives Hermes enforces.

## How

Hermes dispatches `pre_tool_call` to plugin hooks and reads the directive back:

| directive | effect |
|---|---|
| `block` | the call never runs; the message becomes the tool result |
| `approve` | the call reaches the human approval gate, whatever the model intended |

Precedence is `block` > `approve` > none, and one plugin's veto beats another's approve.
Sentinel registers that hook and answers it from the Bot's own policy. It provides **no tools**:
a policy layer must not widen what a Bot can do.

## Policy

Per profile, in that profile's `config.yaml`:

```yaml
plugins:
  enabled: [bot-forge-sentinel]
bot-forge-sentinel:
  refuse: [delete_profile]        # never, whatever is said in the moment
  ask:    [send_email]            # always reach the human gate
  allow:  [post_update]           # fine without asking, even though it looks like a category
  mode: allow                     # or: ask — gate everything not cleared above
  guard_defaults: true            # apply the three categories below
```

With `guard_defaults` on, a tool whose **name** contains a send, spend or delete word reaches
the human gate. The match is on word parts, not substrings, so `undelete_draft` and
`posture_report` are not caught.

Deliberately about the name: a tool called `send_email` is asking to send whatever its
arguments say, and a policy layer that needed to understand every tool's arguments would
understand none of them. Argument-level rules are a later question — see the design note.

## It fails closed

If the policy cannot be read — missing, malformed, or the config call raises — the answer is
**refuse**, with a message saying why. The user sees a refusal rather than silence.

This is the one place Bot Forge's usual "never let it stop the plugin loading" instinct is
wrong. Adoption failing open is fine. Enforcement failing open is not.

## What it is not

- **Not a sandbox.** It governs tool calls Hermes dispatches. A Bot with shell access can act
  outside it; that is what per-Bot sandboxes are for.
- **Not a secret store.** A Bot still holds its own `auth.json`.
- **Not advice to the model.** A rule that only persuades belongs in `SOUL.md`.

Design note and open questions: [`https://github.com/BkashJEE/hermes-bot-forge/blob/main/docs/sentinel.md`](../docs/sentinel.md).

MIT © Bikash Joshi

Originally built for [hermes-bot-forge](https://github.com/BkashJEE/hermes-bot-forge),
where it ships into each Bot it creates. Nothing here depends on Bot Forge.
