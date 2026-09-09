# Muse Code Bridge for Codex / ChatGPT desktop

Ask Muse Code for an independent review, a competing approach, or an implementation from a local desktop conversation. The plugin is named `muse-codex-bridge` in the `muse-code-bridge` marketplace.

## Install

From the repository checkout, run `./install.sh --host codex`. Use `--login` to sign in through the official Muse CLI, or `--check` for a read-only preflight. The root [README](https://github.com/danny-hines/muse-code-bridge#readme) also provides a curl bootstrap that installs missing dependencies.

Muse-managed account credentials are the default; subscription use relies on Muse's onboarding and active plan. For explicit pay-as-you-go access, add `--auth api-key --api-key-file /absolute/private/file`. Both modes use the Muse Code agent. See [authentication setup](https://github.com/danny-hines/muse-code-bridge#login-and-subscription) and the [access comparison](https://github.com/danny-hines/muse-code-bridge/blob/main/docs/access-options.md).

After installation, **fully quit Codex (Cmd+Q on macOS) and reopen it**. Start a **new local conversation** in your project, enable **Muse Code Bridge** in the plugins picker, and ask:

> Ask Muse to review my changes, then compare its findings with yours.

**This does not add Muse Spark to the model picker.** Your selected Codex model coordinates with Muse through tools. Muse has its own conversation and tools; it does not automatically inherit the desktop browser, other plugins, or the full host conversation. The host can share relevant evidence with Muse.

Codex supports [custom model providers](https://learn.chatgpt.com/docs/config-file/config-advanced#custom-model-providers), but a Muse CLI-to-model API adapter is separate work. Neither native provider mode nor Muse model-picker registration is implemented here.

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
