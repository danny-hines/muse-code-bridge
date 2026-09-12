# Experimental Muse model provider for Codex

Select Muse as the model for a new local Codex desktop task. This is separate from the default MCP plugin, where an OpenAI model coordinates with a Muse agent.

## What works

- Model discovery through Codex's custom catalog and `model/list`.
- Responses-compatible text replies, function tools, namespaced tools, and freeform tools such as patch inputs.
- Codex executes requested tools and handles its own approvals. Results return to Muse on the next model request.
- The official Muse CLI owns authentication. The adapter uses the existing bridge's account or explicit API-key mode and never switches modes or providers automatically.
- HTTP disconnect cancellation, process cleanup, a two-minute limit per model request, and a two-request concurrency limit.

This adapter uses a **prompted JSON handoff**, not a raw Meta inference endpoint: it sends the full Codex conversation and tool definitions to a fresh `muse exec` invocation, then translates Muse's structured answer into a Responses message or tool call. Muse's workspace shell, filesystem writes, and web tools are disabled. It runs in a temporary directory, without project rules or foreign personal context. The CLI still owns its native agent prompt/runtime; this does not prove that every Muse-native capability is absent.

Only a completed Muse terminal result is accepted. Invalid JSON, unknown tools, incomplete runs, and unsupported inputs fail explicitly. The server does not execute requested Codex tools itself, retry model requests automatically, or forward an OpenAI request to Meta.

## Install and enable

First install the regular bridge using the root README's bootstrap, or use your existing checkout. From that checkout:

```sh
node dist/muse-native.mjs install
node dist/muse-native.mjs status
node dist/muse-native.mjs enable
```

For a bootstrap installation, the checkout is `~/.local/share/muse-bridge/repo`. If Node was installed by bootstrap, use `~/.local/share/muse-bridge/runtime/bin/node` in place of `node`. No extra npm install or build is required for the committed bundles.

`install` discovers the available models through the official CLI. Use `--model EXACT_ID` to install only one discovered model, or omit it to include the catalog with Muse's marked default first (otherwise the first discovered model). `--port 47831` changes the localhost port. Neither model discovery nor the install command verifies subscription billing. Authentication is selected through the regular bridge installer, as documented in the root README.

On macOS, installation creates a private provider configuration and a LaunchAgent named `com.muse-code-bridge.native`. It starts at login and listens only on `127.0.0.1`. A generated local bearer token protects the endpoint; it is not an OpenAI or Meta API key. On Linux, installation prints the command to run in a terminal or your service manager before enabling Codex.

`enable` backs up the affected Codex settings, selects the `muse_bridge` provider and Muse catalog, sets Muse's initial effort to High, and disables provider-hosted web search. **Fully quit the desktop app and reopen it, then start a new local task.** The picker should show the discovered Muse models with an experimental label. The desktop picker uses the same catalog path verified by the app-server acceptance test; its visual display still needs checking after restart.

Try: “Use the terminal to create a small text file in this project, read it back, and report what you verified.” Codex should display actual tool calls before Muse reports success. `muse-implement` is unnecessary when Muse is already the primary model.

## Switching back and updates

**This version selects one provider configuration for new tasks. It does not provide a combined Astra/Muse menu with automatic routing.** To restore your previous model/provider/effort/search configuration:

```sh
node dist/muse-native.mjs disable
```

Fully quit and reopen the app again. The existing Muse MCP plugin and skills remain available. Unrelated Codex settings are preserved; the helper refuses to overwrite manually changed managed blocks. A private recovery copy is stored at `~/.local/share/muse-bridge/native/codex-restore.json` while enabled. Do not share that file: it includes the original Codex configuration.

After updating the repository, rerun `install` to refresh the bundled service. Do so between requests: it restarts the service. Disable first if changing its model set or port. To remove the macOS login service after disabling:

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
