# Muse Code Bridge for Codex / ChatGPT desktop

Ask Muse Code for an independent review, a competing approach, or an implementation from a local desktop conversation. The plugin is named `muse-codex-bridge` in the `muse-code-bridge` marketplace.

## Install

From the repository checkout, run `./install.sh --host codex`. Use `--login` to sign in through the official Muse CLI, or `--check` for a read-only preflight. The root [README](https://github.com/danny-hines/muse-code-bridge#readme) also provides a curl bootstrap that installs missing dependencies.

Muse-managed account credentials are the default; subscription use relies on Muse's onboarding and active plan. For explicit pay-as-you-go access, add `--auth api-key --api-key-file /absolute/private/file`. Both modes use the Muse Code agent. See [authentication setup](https://github.com/danny-hines/muse-code-bridge#login-and-subscription) and the [access comparison](https://github.com/danny-hines/muse-code-bridge/blob/main/docs/access-options.md).

After installation, **fully quit Codex (Cmd+Q on macOS) and reopen it**. Start a **new local conversation** in your project, enable **Muse Code Bridge** in the plugins picker, and ask:

> Ask Muse to review my changes, then compare its findings with yours.

The plugin includes **muse-implement**, **muse-review**, and the shared **muse** skill. For delegated coding in another project, start a local task there and ask:

> Use muse-implement to implement the following task. You own scope, architectural decisions, and final verification; Muse owns implementation and routine test fixes: …

Use `muse-review` for a second opinion where the host retains implementation. Both specialized skills read the shared Muse protocol. The [skill catalog](https://github.com/danny-hines/muse-code-bridge/blob/main/docs/skills.md) explains the responsibility splits and current limitations. Codex installs all skills together; select the relevant workflow in the conversation.

**The MCP plugin does not add Muse Spark to the model picker.** Your selected Codex model coordinates with Muse through tools. Muse has its own conversation and tools; it does not automatically inherit the desktop browser, other plugins, or the full host conversation. The host can share relevant evidence with Muse.

For Muse as the primary model, use the separate [experimental combined picker on macOS](https://github.com/danny-hines/muse-code-bridge/blob/main/docs/setup.md#select-muse-directly-in-codex--chatgpt-desktop-macos-experimental). It has been user-tested with both OpenAI and Muse model options. After bootstrap, fully quit the app and run:

```sh
"$HOME/.local/share/muse-bridge/repo/scripts/launch-additive-macos.sh"
```

For a clone, run `./scripts/launch-additive-macos.sh` from the checkout. Use the launcher each time you want the combined picker and keep its terminal open. The MCP plugin and skills remain available. No separate service or provider-replacement command is needed. The adapter supports text and tool handoffs; automatic GUI catalog refresh and full desktop feature compatibility still need validation.

**The combined picker is local-only.** For ChatGPT mobile Remote access, fully quit the desktop app and reopen it normally. Older additive builds could compete for the same Remote computer identity and lock tasks in another child process. See [Remote recovery](https://github.com/danny-hines/muse-code-bridge/blob/main/docs/additive-development.md#remote-loading-and-open-in-another-app). The MCP plugin remains installed in the standard runtime.

## Update and remove

Rerun the same bootstrap command, or run `git pull --ff-only` and `./install.sh --host codex` in your clone. Keep the checkout at the same path. When current work has finished, **fully quit Codex (Cmd+Q on macOS), reopen it, and start a new local conversation**. Closing a window or reading the updated skill file does not replace an already running bridge server.

Ask the host to call `muse_status` and show `bridge_version`, `bridge_build`, and `bridge_started_at` when checking an update. These identify the code actually running, not the plugin files currently on disk. Versions predating these diagnostics omit those fields. An older server can remain attached to an existing conversation even after a newer plugin is installed.

The original bridge could report a provisional history snapshot as `failed/incomplete` while Muse was still generating. The polling fix waits for the live completion event. If an older task encountered this, retain its session ID and check the saved session after restarting; do not repeat the prompt automatically, since Muse may have finished successfully.

```sh
codex plugin remove muse-codex-bridge@muse-code-bridge
codex plugin marketplace remove muse-code-bridge
```

If upgrading the unpublished prototype, first remove its old registration:

```sh
codex plugin remove muse-bridge@muse-bridge
codex plugin marketplace remove muse-bridge
```

Removing plugin registrations does not remove your Muse login or sessions. Bootstrap retains the established `~/.local/share/muse-bridge` directory for compatibility. Don't remove shared runtime/source files while another host still uses them.

To stop using the combined picker, fully quit the app and reopen it normally. Its private `additive/preferences.json` and `additive/routes.json` remain available for future launcher sessions. Retain routing state if you want to resume Muse-primary tasks. Reopening a Muse-primary task requires the additive launcher; normal OpenAI tasks keep their usual setup. Removing the MCP plugin alone does not affect the separate launcher.
