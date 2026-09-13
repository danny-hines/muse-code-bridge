# Muse protocol prototype and legacy recovery

**Global provider activation has been withdrawn.** It replaced the normal Astra/OpenAI model options and did not meet the goal of adding Muse alongside them. For current setup, choose the [MCP plugin or experimental combined picker](setup.md). The combined macOS picker has been user-tested; automatic GUI catalog refresh remains under test. This page covers the older standalone protocol service and recovery from its provider-replacement configuration.

The adapter has passed Codex app-server protocol tests. Those tests explicitly select the Muse provider; they do not establish end-to-end desktop picker routing. Seeing Muse in the menu proves catalog loading, not correct request routing.

## Verified at the app-server level

- Model discovery through Codex's custom catalog and `model/list`.
- Responses-compatible text replies, function tools, namespaced tools, and freeform tools such as patch inputs.
- Codex executes requested tools and handles its own approvals. Results return to Muse on the next model request.
- The official Muse CLI owns authentication. The adapter uses the existing bridge's account or explicit API-key mode and never switches modes or providers automatically.
- HTTP disconnect cancellation, process cleanup, a two-minute limit per model request, and a two-request concurrency limit.

This adapter uses a **prompted JSON handoff**, not a raw Meta inference endpoint: it sends the full Codex conversation and tool definitions to a fresh `muse exec` invocation, then translates Muse's structured answer into a Responses message or tool call. Muse's workspace shell, filesystem writes, and web tools are disabled. It runs in a temporary directory, without project rules or foreign personal context. The CLI still owns its native agent prompt/runtime; this does not prove that every Muse-native capability is absent.

The standalone service accepts only a completed Muse terminal result. The newer [additive runtime](additive-development.md) also supports an explicitly validated handoff at a successfully completed Meta response boundary, then intentionally stops Muse's outer loop. Invalid JSON, unknown tools, incomplete runs, and unsupported inputs fail explicitly. The server does not execute requested Codex tools itself, retry model requests automatically, or forward an OpenAI request to Meta.

## Development status

The bootstrap rejects `--native` and `--replace-provider` before installing or changing anything. The native helper rejects `enable`, including `enable --replace-provider`. Recovery through `disable` remains available. Updating the MCP plugin does not restore a previously replaced provider automatically; follow the recovery instructions below.

The adapter code is retained for protocol development. Its standalone `install` command prepares a localhost service and a catalog snapshot without changing Codex settings; it has no supported desktop activation path. On macOS it starts a LaunchAgent. The snapshot is fixed at installation and therefore **does not meet the automatic model discovery requirement**. Do not distribute this prototype as a finished model-picker integration.

Changing `model_provider` and `model_catalog_json` selects one provider and catalog. Appending names does not assign a provider to each model. A combined picker needs a verified integration that routes every selection to the corresponding provider while preserving account authentication. See the [requirements and current findings](additive-models.md), Codex's [provider configuration](https://learn.chatgpt.com/docs/config-file/config-advanced#custom-model-providers), and [app-server interface](https://learn.chatgpt.com/docs/app-server).

A cached model list during a provider change can pair a Muse model name with `openai`, producing the “not supported when using Codex with a ChatGPT account” error. That error alone does not establish that a request reached or failed inside Muse. The existing `verify-native.mjs` test explicitly selects the Muse provider; it does not check this GUI path.

## Switching back and updates

If you enabled an earlier version, restore your previous model/provider/effort/search configuration:

```sh
node dist/muse-native.mjs disable
```

Fully quit and reopen the app again. The existing Muse MCP plugin and skills remain available. Unrelated Codex settings are preserved; the helper refuses to overwrite manually changed managed blocks. A private recovery copy is stored at `~/.local/share/muse-bridge/native/codex-restore.json` while enabled. Do not share that file: it includes the original Codex configuration.

For a default bootstrap installation, the full command works from any directory, even if Node was installed privately:

```sh
"$HOME/.local/share/muse-bridge/runtime/bin/node" "$HOME/.local/share/muse-bridge/repo/dist/muse-native.mjs" disable
```

After recovery, update the supported MCP integration using the standard [bootstrap instructions](setup.md#updates). The native activation flags are no longer accepted. Recovery does not require the service to be healthy or its provider settings file to exist. It still needs the original recovery record and unchanged managed config blocks.

To remove the macOS login service after disabling:

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
