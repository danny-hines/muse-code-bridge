# Additive routing prototype

This is an experimental launch option, included in the repository and bootstrap source but activated separately. The standard installer configures [MCP tools and skills](setup.md). The launcher adds a local routing layer around Codex's app-server protocol; it does not change the saved OpenAI provider or replace the installed desktop application. New users should follow the [quick setup guide](setup.md).

## What is implemented

- The original host model catalog, metadata, and default are retained. Available Muse models are appended under `muse/<official-model-id>` identifiers. Namespacing avoids ambiguous routing; an existing host identifier wins a collision.
- Muse discovery uses the official CLI in the bridge's selected account or API-key mode. It refreshes at startup and every five minutes. The HTTP adapter validates against the same live catalog, so a newly discovered compatible model can actually run.
- Each loaded task has a separate real Codex app-server worker. OpenAI workers keep the normal OpenAI provider and authentication. Muse workers receive process-local provider and catalog overrides. No OpenAI credential is extracted or proxied through a Meta endpoint.
- Four workers is an idle cache target, not a limit on navigation or concurrent tasks. Opening a chat can exceed the target while other workers hold active turns, unsaved chats, pending requests, background terminals, or loaded agents. Idle saved workers are retired when safe, and closed/deleted chats release their workers. A request arriving during eviction waits for process exit and then resumes the saved history.
- The Muse handoff is read at a confirmed successful Meta response boundary. The response must contain exactly one valid adapter JSON decision before the CLI is intentionally stopped. Stream fragments, failed responses, concatenated objects, and unoffered tools are rejected. This avoids concatenating a tool decision with a later waiting message from Muse's outer agent loop, and retains the one-model-step limit.
- A provider switch waits for an idle saved task, closes its worker, and resumes the same task and history under the selected provider. Merely sending `modelProvider` to `thread/resume` on a loaded task does not switch providers in the tested Codex build.
- A private routing-state file records task IDs, provider choices, and model IDs. It contains no prompts or account credentials. It keeps the selected provider consistent across adapter restarts, even when the original task metadata names an earlier provider.
- The desktop's new-chat picker saves model and reasoning defaults in the adapter's private `preferences.json`. Config reads expose these as session overrides, including named profiles. They survive additive-runtime restarts; launching Codex normally continues to use its original settings. Existing chats retain their own routes. Selecting a model in an existing chat routes `thread/settings/update` to the proper worker and reports the selected Muse identifier back to the desktop.
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

This checks the desktop's model-and-effort batch save, config readback, new-chat defaults across restart, existing-chat settings changes in both directions, simultaneous provider routes, host tool round trips, preserved history, forks, a newly discovered Muse model, removal, cancellation, active-task switch rejection, a Muse outage while the host remains usable, and unchanged saved configuration. It also reproduces navigation with an active Muse turn and three prepared empty chats: other histories still load, an OpenAI turn runs without cancelling Muse, and deleting prepared chats frees their workers. Unit tests cover catalog additions from both providers, pagination, collisions, background refresh, private routing state, preference versions, profile isolation, failed writes, protected workers, parent/child activity, cleanup, and concurrent request/eviction races. The real-process test is skipped in ordinary CI unless its executable is explicitly provided.

An optional live test spends a small amount of Muse usage, using the bridge's existing authentication. It only reads the OpenAI catalog and never requests OpenAI generation:

```sh
MUSE_ADDITIVE_CODEX_BIN=/Applications/ChatGPT.app/Contents/Resources/codex node scripts/verify-additive.mjs
```

The test has passed locally with Muse-managed account credentials using Muse Spark 1.3 Contributor and the installed Codex 0.154.0-alpha.6.2 app server. The account catalog check returned six existing OpenAI models plus four Muse entries, preserving Astra as default. These are protocol/account checks, not a GUI acceptance claim.

It replays the desktop's model-and-effort preference save, creates an ephemeral task using that default, asks Muse to call a real Codex host tool, and verifies that Muse's final answer contains the opaque value returned by that tool. It then selects an OpenAI default in the temporary preference store and confirms the ordinary config values are unchanged. This updated flow has also passed with Muse Spark 1.3 Contributor. `MUSE_ADDITIVE_TEST_MODEL` can select another discovered `muse/...` model.

## Temporary desktop test on macOS

**Both model groups and Muse selection have been user-tested successfully in the macOS desktop after the picker-save fix.** Both save paths (new-chat defaults and existing-chat settings) also pass against the real app-server with local model fixtures, and live Muse text/tool generation has passed separately. Automatic GUI refresh and broader desktop feature compatibility remain unverified.

Bootstrap installations and unmodified Git clones include compiled bundles. After installing the prerequisites, fully quit the desktop app and run this from the checkout (build with `npm run build` only after source edits):

```sh
./scripts/launch-additive-macos.sh
```

The launcher refuses to interrupt an already running app. It sets `CODEX_CLI_PATH` and forces a stdio app-server for that app process only. These are internal desktop hooks, not a documented stable plugin API. It creates a temporary executable wrapper and keeps the terminal open for the app session. It does not edit Codex settings, shell profiles, or LaunchAgents. Reopening the app normally restores the standard runtime.

Use a new, disposable local task for the GUI test. Confirm that all normal OpenAI models remain visible, select a Muse model if it appears, and ask for a short answer followed by a simple host tool call. Then verify switching to OpenAI and back. If Muse does not appear, do not add a global `model_catalog_json` or replace `model_provider`; the app's filtering layer still needs integration work.

After updating the checkout or rebuilding the adapter, fully quit and relaunch with the same command. An already-running adapter keeps its loaded code. In particular, a launch from before the picker-save fix rejects Muse defaults with **“Couldn't update model settings.”** Restarting only the chat does not load the fix.

If an older runtime reports **“The prototype has four busy or unsaved task workers”** while opening another chat, update the checkout and fully relaunch. The worker-cache fix removes that navigation limit without interrupting running turns. Let any current work finish before quitting.

The app is expected at `/Applications/ChatGPT.app`. Set `MUSE_ADDITIVE_APP_PATH` for another location. The launcher discovers bootstrap's private Node/Muse tools, including in custom managed roots; `MUSE_BRIDGE_NODE_BIN` and `MUSE_BRIDGE_EXECUTABLE` override them explicitly. `--check` validates local prerequisites without launching the app or checking account access. Routing state defaults to `~/.local/share/muse-bridge/additive`, or `additive/` under `MUSE_BRIDGE_ROOT`; `MUSE_ADDITIVE_STATE_DIR` can select another private directory. Do not run more than one adapter against the same tasks. After a forced process kill, a stale `runtime.lock` may need removal, but only after confirming that no additive runtime remains active.

The standard runtime cannot resume a Muse-primary task using this custom provider on its own. Reopen the development runtime to continue such a task. Ordinary OpenAI tasks and the existing Muse MCP skills retain their normal setup.

## Limits before a native release

- The desktop may filter model entries independently of `model/list`. Its own cache also controls when updated options appear. The prototype polls Muse and serves current combined catalogs, but has not established the requested automatic GUI refresh bound.
- One worker per loaded task costs more local memory and startup work. The four-worker cache target can be exceeded to preserve active or unsaved work; it is not a memory ceiling. Large workspaces and unattended automation still need testing.
- Cross-provider switches require saved local tasks. Reloading or forking ephemeral tasks across workers is unsupported. Switching while a turn is active, or when the worker has pending requests, background terminals, or other loaded tasks/subagents, is rejected.
- Some account-wide events, advanced task operations, authentication changes during a session, remote hosts, cloud tasks, shared daemons, and full desktop tool compatibility still need acceptance coverage. Stdio is the only supported transport.
- Model/effort writes are private adapter preferences; other settings continue through Codex. A batch mixing model preferences with unrelated settings is rejected before applying any edit. Global provider/catalog changes, whole-profile replacements, and project-file model writes remain unsupported. Preference writes use the version returned by the bridge (or no `expectedVersion`, as the desktop picker does); an ordinary config-file version is not a preference version. Clearing a preference with `null` restores the original Codex value.
- Muse inherits the [text/tool adapter limits](native-provider.md#current-limits-and-evidence): buffered JSON handoffs, full-history replay, no image/audio/file inputs, and a conservative context limit. This is not a transparent implementation of every Codex feature.

Meet the remaining [additive model acceptance requirements](additive-models.md) before making this a standard installation option.
