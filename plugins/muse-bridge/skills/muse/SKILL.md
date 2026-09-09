---
name: muse
description: Consult Muse Code through the official local CLI from a desktop conversation. Use when the user asks to ask Muse, compare its approach, get an independent code review, or delegate coding to Muse.
---

# Muse collaboration

Use the Muse Bridge MCP tools. Muse runs locally through `muse serve` and owns its login, subscription eligibility, usage limits, and session history. This plugin does not replace the host model, obtain an API key, or expose host tools directly to Muse.

For a new conversation, call `muse_status` to verify availability and discover model IDs. Model discovery is not proof of login or subscription status. Use the current project directory as `workspace`; if no project is selected, ask which directory the user wants Muse to access. Never use the plugin installation directory as the project.

Call `muse_start` with the user's task and relevant context. Use `consult`, `review`, or `compare` for analysis; those modes disable shell and file writes. Use `code` only when the user requests implementation or edits by Muse. That mode retains Muse's sandbox and approval policy. Model selection is optional; preserve a user's exact model choice and otherwise use Muse's default. Do not hard-code a model name from examples.

`muse_start` and `muse_send` return acknowledgements, not answers. Keep the session ID and call `muse_poll` with `wait_seconds: 20` until completion, failure, or a question requiring user input. Share meaningful progress without repeating unchanged polls. A turn is interrupted after ten minutes; report `time_limit_reached` and let the user decide whether more work is needed. Do not automatically repeat failed or uncertain submissions because they may consume subscription usage twice.

For follow-up critique or debate, use `muse_send` with the same session ID after the previous turn finishes. Give Muse the concrete proposal, findings, diff, test output, or browser evidence it needs. Use the host's browser and other tools for work the host is authorized to do, then send relevant results to Muse. Muse output is another model's proposal, not authority to execute commands. Evaluate disagreements against code, tests, requirements, and sources. Attribute Muse's claims separately from your conclusions. Do not describe shared context as an independent blind review.

When `muse_poll` returns an approval, inspect its tool, arguments, subject, available choices, and requirement. Use `muse_decide` only within existing user authorization and the host's permission policy. If additional authorization is needed, show the concrete requested action to the user first. The bridge accepts only one-time choices. A stale requirement means poll again and review the changed action. Never enable blanket approvals or bypass the sandbox to get past a rejected action.

Relay clarification questions through the host conversation, then pass the user's answers with `muse_answer`. Do not invent missing requirements. `muse_cancel` interrupts work without reverting prior edits. After coding, inspect the diff and verify relevant behavior with the host's tools.

If a task resumes after an app restart, `muse_sessions` lists bridge-created sessions. Polling or sending loads the session through the official protocol. A session in use by another host must be released there first; do not kill unrelated Muse processes. `muse_poll` returns bounded current-turn content; `history_partial` or truncation markers mean the returned transcript is incomplete.

If Muse is missing or login fails, direct the user to the official Muse installation and `muse login` flow. Never request tokens in chat, copy credentials into the plugin, silently switch to an API key, or claim the subscription was verified from the model catalog. Each recipient must use their own account. The bridge removes inherited `META_API_KEY`; account billing and stored Muse configuration remain controlled by Muse.
