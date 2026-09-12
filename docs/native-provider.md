# Experimental Muse model provider for Codex

**This is a provider-replacement prototype, not an additive desktop model picker.** Activation hides the normal Astra/OpenAI model options. To keep those options and use Muse from the desktop, install the [MCP plugin](setup.md).

The adapter has passed Codex app-server protocol tests. Those tests explicitly select the Muse provider; they do not establish end-to-end desktop picker routing. Seeing Muse in the menu proves catalog loading, not correct request routing.

## Verified at the app-server level

- Model discovery through Codex's custom catalog and `model/list`.
- Responses-compatible text replies, function tools, namespaced tools, and freeform tools such as patch inputs.
- Codex executes requested tools and handles its own approvals. Results return to Muse on the next model request.
- The official Muse CLI owns authentication. The adapter uses the existing bridge's account or explicit API-key mode and never switches modes or providers automatically.
- HTTP disconnect cancellation, process cleanup, a two-minute limit per model request, and a two-request concurrency limit.

This adapter uses a **prompted JSON handoff**, not a raw Meta inference endpoint: it sends the full Codex conversation and tool definitions to a fresh `muse exec` invocation, then translates Muse's structured answer into a Responses message or tool call. Muse's workspace shell, filesystem writes, and web tools are disabled. It runs in a temporary directory, without project rules or foreign personal context. The CLI still owns its native agent prompt/runtime; this does not prove that every Muse-native capability is absent.

Only a completed Muse terminal result is accepted. Invalid JSON, unknown tools, incomplete runs, and unsupported inputs fail explicitly. The server does not execute requested Codex tools itself, retry model requests automatically, or forward an OpenAI request to Meta.

## Prepare without changing model selection

On macOS, prepare the service with your own Muse account:

```sh
curl -fsSL https://raw.githubusercontent.com/danny-hines/muse-code-bridge/main/bootstrap.sh | bash -s -- --native --auth account --login
```

Complete the official Muse browser sign-in. The script installs missing dependencies and the MCP plugin, prepares the native service, and checks its health. **It preserves the current Codex model/provider selection. It does not add models to the picker.** Existing replacement-mode users remain in replacement mode until they run `disable`.

For an existing checkout, the equivalent preparation is:

```sh
node dist/muse-native.mjs install
node dist/muse-native.mjs status
```

For a bootstrap installation, the checkout is `~/.local/share/muse-bridge/repo`. If Node was installed by bootstrap, use `~/.local/share/muse-bridge/runtime/bin/node` in place of `node`. No extra npm install or build is required for the committed bundles.

`install` discovers models through the official CLI. Fresh installs include the discovered catalog with Muse's marked default first. Reruns preserve the installed model set and port. Use `--model EXACT_ID` to select one model or `--port NUMBER` to change the port (initially 47831); disable first when changing either. Setup stops if a previously selected model is unavailable. Discovery and health checks do not verify subscription billing.

On macOS, preparation creates a private provider configuration and a LaunchAgent named `com.muse-code-bridge.native`. It starts at login and listens only on `127.0.0.1`, protected by a generated local bearer token. On Linux, manual `install` prints the command to run under your service manager. See the [setup guide](setup.md) for authentication options.

## Explicit provider replacement

Use this only for an experiment where **replacing the normal model options with Muse is the intended outcome**:

```sh
node dist/muse-native.mjs enable --replace-provider
```

The bootstrap equivalent is `--native --replace-provider`. Both require the explicit replacement option; plain `enable` refuses before any settings change.

Activation backs up the affected settings, selects `muse_bridge` and the Muse-only catalog, sets initial effort to High, and disables provider-hosted web search. Fully quit and reopen Codex after enabling or disabling; start a new local task. Previously created tasks may retain their provider. A cached model list during a provider change can also pair a Muse model name with `openai`, producing the “not supported when using Codex with a ChatGPT account” error. That error alone does not establish that a request reached or failed inside Muse.

Desktop acceptance still requires verifying the new task's provider and an actual tool round trip through the GUI. The existing `verify-native.mjs` test checks the app-server protocol with explicit provider selection, not this GUI path.

## Why this does not add models alongside Astra

The current adapter changes `model_provider` and `model_catalog_json`. Appending names to a catalog does not assign a different provider to each name. A combined picker needs a verified integration that routes every selection to its corresponding provider while preserving account authentication. This repository has not implemented that integration. See Codex's [provider configuration](https://learn.chatgpt.com/docs/config-file/config-advanced#custom-model-providers) and [app-server interface](https://learn.chatgpt.com/docs/app-server).

## Switching back and updates

**This version selects one provider configuration for new tasks. It does not provide a combined Astra/Muse menu with automatic routing.** To restore your previous model/provider/effort/search configuration:

```sh
node dist/muse-native.mjs disable
```

Fully quit and reopen the app again. The existing Muse MCP plugin and skills remain available. Unrelated Codex settings are preserved; the helper refuses to overwrite manually changed managed blocks. A private recovery copy is stored at `~/.local/share/muse-bridge/native/codex-restore.json` while enabled. Do not share that file: it includes the original Codex configuration.

For a default bootstrap installation, the full command works from any directory, even if Node was installed privately:

```sh
"$HOME/.local/share/muse-bridge/runtime/bin/node" "$HOME/.local/share/muse-bridge/repo/dist/muse-native.mjs" disable
```

To update a bootstrap installation on macOS, run the following **between requests**, since it restarts the service:

```sh
curl -fsSL https://raw.githubusercontent.com/danny-hines/muse-code-bridge/main/bootstrap.sh | bash -s -- --native --no-login
```

This preserves the authentication choice, port, installed models, and original Codex recovery copy. Updates do not enable or disable replacement mode. Repeated `enable --replace-provider` validates an already enabled setup without replacing the recovery copy. For a clone, update the repository and rerun `install` and `status`. Disable first if changing its model set or port. To remove the macOS login service after disabling:

```sh
launchctl bootout "gui/$(id -u)/com.muse-code-bridge.native"
rm "$HOME/Library/LaunchAgents/com.muse-code-bridge.native.plist"
```

The private `~/.local/share/muse-bridge/native` directory can then be removed. This does not remove Muse login credentials or the MCP plugin.

## Current limits and evidence

- **Text only.** Images, screenshots, audio, uploaded files, and provider-hosted tools are rejected. Full browser, connector, image generation, and desktop feature compatibility is not established. Text-based host tools may work but need individual testing.
- JSON is buffered until Muse finishes, then emitted as Responses SSE events. Heartbeats keep the connection alive; this is not live token streaming.
- Full history is replayed each request. This adds latency and Muse context usage. There is no savings benchmark, conversation-state cache, or raw API backend yet. Both auth modes currently run through the official CLI.
- The catalog uses a conservative 64,000-token adapter operating limit, not a claim about Meta's model capacity. Oversized requests fail; context is not silently discarded. Previous-response IDs and background Responses are unsupported.
- The selected model is passed explicitly to the CLI. High is the starting effort; the catalog offers Low, Medium, High, and Extra High. OpenAI reasoning state is not transferable.
- Automated tests cover HTTP authentication, unsupported input, function/freeform translation, exact restore, cancellation, failed terminal output, and temporary prompt cleanup.
- `node scripts/verify-native.mjs` explicitly spends a small amount of Muse usage. It starts an ephemeral Codex app server, confirms model discovery, asks Muse to call a real Codex dynamic tool, and checks that Muse's next answer contains the opaque marker returned by that tool. A second turn verifies that Codex interruption cancels the active provider request. No persistent Codex configuration is changed by this test. Both checks have passed locally using Muse-managed account credentials.

Codex interfaces: [custom providers](https://learn.chatgpt.com/docs/config-file/config-advanced#custom-model-providers), [model catalog configuration](https://learn.chatgpt.com/docs/config-file/config-reference), [Responses streaming](https://developers.openai.com/api/docs/guides/streaming-responses).
