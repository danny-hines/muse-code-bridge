---
name: muse-review
description: Ask Muse Code to review code or an implementation independently, then have the host verify findings against evidence. Use for a Muse second opinion or review of host-authored changes; implementation remains with the host.
---

# Review with Muse

Read `../muse/SKILL.md` for the bridge protocol unless it is already in context. The installer includes that companion skill. This workflow requests analysis from Muse and leaves implementation with the host.

Identify the review target from the user's request: a working diff, selected files, a commit, or a broader subsystem. Preserve existing edits. Give Muse the relevant requirements, scope, file pointers, and known constraints with `muse_start` using `role: review`. This mode disables Muse's shell and file writes; supply diffs, test output, or other evidence it cannot obtain through those tools. Ask for concrete defects, affected locations, impact, and reproduction steps where possible.

For an independent review, share the requirements and raw evidence before the host's own findings. If Muse has already seen those findings or produced the implementation in that session, describe the review as informed by shared context. A new Muse session can separate conversational context, but does not make the models statistically independent.

Collect the completed result through the bridge protocol. Evaluate each material finding against the code, requirements, and executable evidence. Run targeted reproductions where useful; use the host browser for visual or interaction claims. Distinguish verified defects from plausible concerns and disagreements. Do not accept severity or correctness solely because another model asserted it.

If evidence challenges a finding, send the evidence to the same Muse session and ask for reassessment when it could change the outcome. Avoid repeated debate without new evidence. Correctness and the user's requirements determine the decision; agreement between models is not a test.

Report actionable findings concisely, with locations and verification status, and preserve the session ID for follow-up. If the user requested review only, leave source files unchanged. If fixes are authorized, the host can implement and verify them. Switch to a new `code` session only if the user requests Muse implementation; a review session's access mode cannot be upgraded in place.
