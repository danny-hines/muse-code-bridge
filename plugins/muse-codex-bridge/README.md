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

## Combined model picker on macOS

For Muse as the selected model, install the separate [ChatGPT + Muse companion shortcut](https://github.com/danny-hines/muse-code-bridge/blob/main/docs/shared-gateway-design.md#install-and-use). From an unmodified checkout with Node.js 22+ and Muse available:

```sh
node scripts/install-shared-macos.mjs --dock
```

The [setup guide](https://github.com/danny-hines/muse-code-bridge/blob/main/docs/setup.md#select-muse-directly-in-codex--chatgpt-desktop-macos-experimental) includes the equivalent command for bootstrap's private tools. The companion uses the ChatGPT icon with a Meta badge. Fully quit the app before opening it; no Terminal window must remain open. The original ChatGPT icon starts the normal app independently.

The shared gateway uses one native task server, with OpenAI and Muse inference routed by model ID. OpenAI traffic also passes through the local gateway, retaining native authentication. Muse uses the bridge's configured CLI account or key. Desktop model/effort defaults are stored privately; Remote settings retain native persistence.

This is **experimental and version-checked** against `codex-cli 0.154.0-alpha.6.2`. Native fixture tests and live OpenAI → Muse → OpenAI turns passed. Actual desktop/phone Remote behavior, mobile picker visibility and automatic GUI catalog refresh still need acceptance checks. Muse supports text and host tool handoffs; broader capabilities and failure behavior are detailed in the [gateway guide](https://github.com/danny-hines/muse-code-bridge/blob/main/docs/shared-gateway-design.md#limits-and-remote-verification).

The old `launch-additive-macos.sh` uses multiple native workers and is **local-only**, with Remote disabled in every child. It is separate from the companion shortcut. For older mobile loading or task writer conflicts, follow [Remote recovery](https://github.com/danny-hines/muse-code-bridge/blob/main/docs/additive-development.md#remote-loading-and-open-in-another-app).

## Update and remove

Rerun the same bootstrap command, or run `git pull --ff-only` and `./install.sh --host codex` in your clone. Keep the checkout at the same path. If using the companion app, rerun its installer too: it launches a versioned bundle copy, so a plugin update alone does not update it. After a native app update, use the original icon until the new executable version is verified and accepted by the companion installer. When current work has finished, **fully quit Codex (Cmd+Q on macOS), reopen it, and start a new local conversation**. Closing a window or reading the updated skill file does not replace an already running bridge server.

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

To bypass the shared gateway, fully quit the app and open the original ChatGPT icon. Tasks saved with Muse, or a Muse default saved remotely, may need an OpenAI selection; history is retained. To remove the companion and its private files, follow [updates and removal](https://github.com/danny-hines/muse-code-bridge/blob/main/docs/shared-gateway-design.md#updates-and-removal). Removing the MCP plugin alone does not remove the companion.

For the older additive runtime, retain `additive/preferences.json` and `additive/routes.json` while keeping its Muse-primary tasks. Those custom-provider tasks still require that launcher; the shared gateway does not automatically migrate its routing records.
