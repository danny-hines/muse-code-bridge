---
name: muse-implement
description: Use Muse Code as the primary implementer while the host owns scope, architectural decisions, and final verification. Use when the user asks to delegate implementation to Muse or conserve host-model usage by having Muse execute a coding task.
---

# Implement with Muse

Read `../muse/SKILL.md` for the bridge protocol unless it is already in context. The installer includes that companion skill. Use the connected Muse tools, not a different provider's subagent. This skill guides delegation; it does not change the host model, reasoning setting, billing route, or enforce a token budget.

## Scope the handoff

Use the user's current project and instructions. Inspect enough local context to identify the change boundary, existing edits, and acceptance criteria. Preserve user work. For a clear task, hand it to Muse promptly; do not first solve the implementation yourself. For ambiguous architecture, resolve the consequential decisions before delegating. Infer routine details from the repository, asking only when missing information materially affects the result.

Give Muse a bounded milestone in `muse_start` with `role: code`. Include the desired behavior, constraints, relevant file pointers, decisions already made, and commands or evidence that establish completion. Prefer a complete feature slice or coherent repair over individual file edits. Size milestones to fit the bridge's ten-minute turn limit. Use Muse's session for implementation, appropriate tests, and routine correction of failures. Preserve explicitly requested models and reasoning effort; the host's effort setting does not automatically apply to Muse.

Tell Muse to return changed file paths, a concise explanation of its decisions, commands run with outcomes, and remaining uncertainties. Give it room to make routine implementation decisions within the agreed scope. A request to use this skill does not authorize changes outside the user's task or imply permission to publish, deploy, or send messages.

## Supervise at decision points

Wait through the bridge protocol. Resolve concrete approvals within existing authorization and relay questions when required. Do not duplicate Muse's ongoing investigation or edit the same files concurrently. Use host-only tools, such as the desktop browser, when useful and pass the relevant observations to Muse; those tools and the host conversation are not automatically shared.

On completion, inspect the actual diff and test evidence. Verify the critical behavior with the host's tools at a depth appropriate to the change, without repeating every exploratory step. Passing tests alone do not establish that the requirements were met. Send concrete corrections through `muse_send` on the same session, including what failed and the evidence. If corrections repeatedly fail or require a new architectural decision, reassess the approach rather than continuing an unproductive loop. Report the reason if the host needs to take over work the user asked Muse to perform.

Finish with what Muse implemented, what the host verified, unresolved issues, and the session ID for follow-up. Keep logs and lengthy reports in workspace artifacts only when useful; link them instead of copying them repeatedly into chat. Do not claim allowance savings without measurements.
