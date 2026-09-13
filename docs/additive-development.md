# Additive routing prototype

This is a development build, not the standard installer. The supported public setup remains [MCP tools and skills](setup.md). The prototype adds a local routing layer around Codex's app-server protocol; it does not change the saved OpenAI provider or replace the installed desktop application.

## What is implemented

- The original host model catalog, metadata, and default are retained. Available Muse models are appended under `muse/<official-model-id>` identifiers. Namespacing avoids ambiguous routing; an existing host identifier wins a collision.
- Muse discovery uses the official CLI in the bridge's selected account or API-key mode. It refreshes at startup and every five minutes. The HTTP adapter validates against the same live catalog, so a newly discovered compatible model can actually run.
- Each loaded task has a separate real Codex app-server worker. OpenAI workers keep the normal OpenAI provider and authentication. Muse workers receive process-local provider and catalog overrides. No OpenAI credential is extracted or proxied through a Meta endpoint.
- The Muse handoff is read at a confirmed successful Meta response boundary. The response must contain exactly one valid adapter JSON decision before the CLI is intentionally stopped. Stream fragments, failed responses, concatenated objects, and unoffered tools are rejected. This avoids concatenating a tool decision with a later waiting message from Muse's outer agent loop, and retains the one-model-step limit.
- A provider switch waits for an idle saved task, closes its worker, and resumes the same task and history under the selected provider. Merely sending `modelProvider` to `thread/resume` on a loaded task does not switch providers in the tested Codex build.
- A private routing-state file records task IDs, provider choices, and model IDs. It contains no prompts or account credentials. It keeps the selected provider consistent across adapter restarts, even when the original task metadata names an earlier provider.
- Server requests, including dynamic tool calls and approval requests, get unique routing IDs so simultaneous workers cannot consume one another's replies. Cancellation reaches the worker and the active Muse request.
- Removed models, discovery failures, and invalid routes fail explicitly. The adapter never changes from Muse to OpenAI, or from subscription authentication to API authentication, as an error fallback.

## Verification

Run the ordinary checks:

```sh
npm ci --ignore-scripts
npm run check
```

The real app-server acceptance test uses only local fixture model endpoints and an isolated Codex home. It does not use either account for model generation. Point it at the installed real Codex binary:

```sh
MUSE_ADDITIVE_TEST_CODEX_BIN=/Applications/ChatGPT.app/Contents/Resources/codex node --test test/additive-live.test.mjs
```

This checks simultaneous provider routes, host tool round trips, switches in both directions with preserved history, forks, restart/resume, a newly discovered Muse model, removal, cancellation, active-task switch rejection, a Muse outage while the host remains usable, and unchanged saved configuration. Unit tests cover catalog additions from both providers, pagination, collisions, background refresh, and private routing state. The real-process test is skipped in ordinary CI unless its executable is explicitly provided.

An optional live test spends a small amount of Muse usage, using the bridge's existing authentication. It only reads the OpenAI catalog and never requests OpenAI generation:

```sh
MUSE_ADDITIVE_CODEX_BIN=/Applications/ChatGPT.app/Contents/Resources/codex node scripts/verify-additive.mjs
```

The test has passed locally with Muse-managed account credentials using Muse Spark 1.3 Contributor and the installed Codex 0.154.0-alpha.6.2 app server. The account catalog check returned six existing OpenAI models plus four Muse entries, preserving Astra as default. These are protocol/account checks, not a GUI acceptance claim.

It creates an ephemeral Muse task, asks Muse to call a real Codex host tool, and verifies that Muse's final answer contains the opaque value returned by that tool. `MUSE_ADDITIVE_TEST_MODEL` can select another discovered `muse/...` model.

## Temporary desktop test on macOS

**GUI visibility, the app's model filtering, and automatic picker refresh remain unverified.** This launcher is for testing those behaviors; protocol tests do not establish them.

After building the repository, fully quit the desktop app and run this from the checkout:

```sh
./scripts/launch-additive-macos.sh
```

The launcher refuses to interrupt an already running app. It sets `CODEX_CLI_PATH` and forces a stdio app-server for that app process only. These are internal desktop hooks, not a documented stable plugin API. It creates a temporary executable wrapper and keeps the terminal open for the app session. It does not edit Codex settings, shell profiles, or LaunchAgents. Reopening the app normally restores the standard runtime.

Use a new, disposable local task for the GUI test. Confirm that all normal OpenAI models remain visible, select a Muse model if it appears, and ask for a short answer followed by a simple host tool call. Then verify switching to OpenAI and back. If Muse does not appear, do not add a global `model_catalog_json` or replace `model_provider`; the app's filtering layer still needs integration work.

The app is expected at `/Applications/ChatGPT.app`. Set `MUSE_ADDITIVE_APP_PATH` for another location and `MUSE_BRIDGE_NODE_BIN` if Node is installed privately. Routing state defaults to `~/.local/share/muse-bridge/additive`; `MUSE_ADDITIVE_STATE_DIR` can select another private directory. Do not run more than one adapter against the same tasks. After a forced process kill, a stale `runtime.lock` may need removal, but only after confirming that no additive runtime remains active.

The standard runtime cannot resume a Muse-primary task using this custom provider on its own. Reopen the development runtime to continue such a task. Ordinary OpenAI tasks and the existing Muse MCP skills retain their normal setup.

## Limits before a native release

- The desktop may filter model entries independently of `model/list`. Its own cache also controls when updated options appear. The prototype polls Muse and serves current combined catalogs, but has not established the requested automatic GUI refresh bound.
- One worker per loaded task costs more local memory and startup work. The prototype caps workers at four and can evict idle saved tasks after a turn completes. Busy workers, unsaved tasks, and workers owning other loaded agents are not evicted. Large workspaces and unattended automation still need testing.
- Cross-provider switches require saved local tasks. Reloading or forking ephemeral tasks across workers is unsupported. Switching while a turn is active, or when the worker also owns other loaded tasks/subagents, is rejected.
- Some account-wide events, advanced task operations, authentication changes during a session, remote hosts, cloud tasks, shared daemons, and full desktop tool compatibility still need acceptance coverage. Stdio is the only supported transport. Global writes of a Muse default/provider/catalog are rejected to protect the standard configuration.
- Muse inherits the [text/tool adapter limits](native-provider.md#current-limits-and-evidence): buffered JSON handoffs, full-history replay, no image/audio/file inputs, and a conservative context limit. This is not a transparent implementation of every Codex feature.

Meet the remaining [additive model acceptance requirements](additive-models.md) before making this a standard installation option.
