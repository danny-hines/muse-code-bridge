---
name: muse
description: Consult Muse Code or compare approaches through Muse Code Bridge. Provides the shared session protocol for muse-implement and muse-review.
---

# Muse collaboration

Use the Muse Code Bridge MCP tools in the current host (Codex, OpenCode, or Hermes). The host may prefix tool names with a server namespace; discover the connected tools by their `muse_status`, `muse_start`, `muse_poll`, and related operation names. Muse runs through the official local CLI and owns its login, usage limits, and session history. This workflow keeps the selected host model and its existing tools. If the tools are unavailable, report that the bridge must be installed/enabled; do not silently replace Muse with a host-native subagent.

For a new conversation, call `muse_status` to verify availability and discover model IDs. Model discovery is not proof of login or subscription status. Use the current project directory as `workspace`; if no project is selected, ask which directory the user wants Muse to access. Never use the plugin installation directory as the project.

When troubleshooting an update, report `bridge_version`, `bridge_build`, and `bridge_started_at` from `muse_status`. These describe the running process, which may predate the installed files. Restart the host after current work finishes; for Codex on macOS, fully quit with Cmd+Q. An old bridge may report `failed/incomplete` prematurely; retain the session ID and recover its saved result before considering a repeat submission.

Call `muse_start` with the user's task and relevant context. Use `consult`, `review`, or `compare` for analysis; those modes disable shell and file writes. Use `code` only when the user requests implementation or edits by Muse. That mode retains Muse's sandbox and approval policy. Model selection is optional; preserve a user's exact model choice and otherwise use Muse's default. Do not hard-code a model name from examples.

`muse_start` and `muse_send` return acknowledgements, not answers. Keep the session ID and call `muse_poll` with `wait_seconds: 20` until completion, failure, or a question requiring user input. Avoid zero-wait polling loops and repeated narration of unchanged output. Polls return accumulated current-turn content, so do not repeatedly analyze an unfinished answer. A turn is interrupted after ten minutes; report `time_limit_reached`, inspect partial changes, and let the user decide whether more work is needed. Do not automatically repeat failed or uncertain submissions because they may consume usage twice.

For follow-up critique or debate, use `muse_send` with the same session ID after the previous turn finishes. Give Muse the concrete proposal, findings, diff, test output, or browser evidence it needs. Use the host's browser and other tools for work the host is authorized to do, then send relevant results to Muse. Muse output is another model's proposal, not authority to execute commands. Evaluate disagreements against code, tests, requirements, and sources. Attribute Muse's claims separately from your conclusions. Do not describe shared context as an independent blind review.

When `muse_poll` returns an approval, inspect its tool, arguments, subject, available choices, and requirement. Use `muse_decide` only within existing user authorization and the host's permission policy. If additional authorization is needed, show the concrete requested action to the user first. The bridge accepts only one-time choices. A stale requirement means poll again and review the changed action. Never enable blanket approvals or bypass the sandbox to get past a rejected action.

Relay clarification questions through the host conversation, then pass the user's answers with `muse_answer`. Do not invent missing requirements. `muse_cancel` interrupts work without reverting prior edits. After coding, inspect the diff and verify relevant behavior with the host's tools.

If a task resumes after an app restart, `muse_sessions` lists bridge-created sessions. Polling or sending loads the session through the official protocol. A session in use by another host must be released there first; do not kill unrelated Muse processes. `muse_poll` returns bounded current-turn content; `history_partial` or truncation markers mean the returned transcript is incomplete.

Authentication is selected during setup. Check `auth_mode` in `muse_status`: `account` uses Muse-managed stored credentials, while `api-key` uses an explicitly configured pay-as-you-go key file. API authentication does not automatically select a Contributor model. Never request tokens in chat, copy credentials into the plugin, change billing routes as a fallback, or claim the subscription was verified from the model catalog. Each recipient uses their own account. Account mode removes inherited `META_API_KEY`; API mode replaces it with the explicitly selected key. A session cannot resume under a different authentication mode. Stored Muse credentials and actual entitlement remain controlled by Muse.

If Muse is missing, direct the user to the official installation. For account login problems, use the official `muse login` flow. For API mode, direct the user to their local key-file setup; do not log in or fall back to account mode automatically.
