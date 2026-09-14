# ChatGPT + Muse: two shortcuts, one native task server

Status reviewed September 13, 2026. The experimental shared gateway passed native fixture and live account-mode checks with ChatGPT's `codex-cli 0.154.0-alpha.6.2`. Actual desktop/phone Remote behavior and mobile picker visibility are still unverified. It replaces the earlier additive architecture for this launch mode; the old additive launcher remains local-only.

## Install and use

Install the MCP bridge and sign in to Muse using [bootstrap](setup.md#keep-your-model-options-and-use-muse-as-a-collaborator), then run:

```sh
bridge_root="${MUSE_BRIDGE_ROOT:-$HOME/.local/share/muse-bridge}"
MUSE_BRIDGE_EXECUTABLE="$bridge_root/runtime/bin/muse" \
  "$bridge_root/runtime/bin/node" \
  "$bridge_root/repo/scripts/install-shared-macos.mjs" --dock
```

From an unmodified Git checkout with Node.js 22+ and Muse available, the committed bundles and icon are ready to install:

```sh
node scripts/install-shared-macos.mjs --dock
```

If you changed source files, run `npm ci --ignore-scripts` and `npm run build` first. The shortcut installer does not install dependencies, sign in, make model requests, or restart ChatGPT.

This installs `~/Applications/ChatGPT + Muse.app`, using the ChatGPT logo with a Meta badge, and adds it alongside the original ChatGPT icon in the Dock. Omit `--dock` to install only the companion app. Fully quit ChatGPT with Cmd+Q before switching shortcuts. Starting another shortcut while ChatGPT is running cannot change that process's environment.

- **ChatGPT** starts the installed app normally, with its native OpenAI connection.
- **ChatGPT + Muse** starts that same installed app with both model groups available through a local inference gateway. No Terminal window is needed.

The launcher creates a temporary CLI shim and passes `openai_base_url` only to its native server process. It does not edit the installed app, shell profiles, login services, saved provider settings, account credentials, task databases, or Remote enrollment. Its versioned payload lives in `~/.local/share/muse-bridge/shared-launcher/`. Desktop picker defaults are stored separately in `~/.local/share/muse-bridge/shared/model-preferences.json`.

The installer accepts only `codex-cli 0.154.0-alpha.6.2`. Each launch checks that the native executable still matches the version recorded at installation. Check the installed files and version without launching the app:

```sh
"$HOME/Applications/ChatGPT + Muse.app/Contents/MacOS/muse-launch" --check
```

This does not test account access or Remote. Optional environment overrides are `MUSE_SHARED_APP_PATH` (default `/Applications/ChatGPT.app`), `MUSE_BRIDGE_ROOT`, `MUSE_BRIDGE_NODE_BIN`, and `MUSE_BRIDGE_EXECUTABLE`. The installer records explicit `CODEX_HOME` and `MUSE_BRIDGE_CONNECTION_FILE` overrides if present. Use absolute paths. The bootstrap command above explicitly selects its private Muse executable so installation does not depend on your shell PATH.

## Updates and removal

After updating the repository or bootstrap snapshot, rerun the companion installer, then fully quit and relaunch ChatGPT + Muse. The companion runs a versioned copy of the bundles; updating only the MCP plugin or checkout does not update that copy. After a native app update, it refuses to activate until the new version has been verified and accepted by the installer. The original icon continues to work independently.

After changing authentication mode, account or upstream endpoint settings, fully quit and relaunch the companion so it rebuilds its startup configuration. To remove it, quit ChatGPT, remove the companion app and its Dock tile, and optionally delete `shared-launcher` and `shared` under the selected bridge root. Those directories hold launcher payloads and private model defaults, not the native task history. Removing the companion does not remove the MCP plugin or Muse login. No global gateway URL needs restoration.

A task saved with Muse, or a Muse default saved remotely, may need an OpenAI selection in the stock app. Older additive custom-provider tasks are separate: keep their `additive/routes.json` and use the [legacy instructions](additive-development.md); this installer does not migrate them.

## How requests flow

```mermaid
flowchart LR
  Desktop[Desktop] --> Native[One native Codex task server]
  Mobile[Mobile Remote] --> Native
  Native --> Gateway[Local model gateway]
  Gateway --> OpenAI[OpenAI: native authentication]
  Gateway --> Muse[Muse Code: bridge authentication]
```

Codex owns tasks, writer locks, history, tools, approvals and Remote. The gateway routes inference by the selected model ID; it does not create a worker per task or provider. A short-lived native discovery process has Remote disabled and exits before the real task server starts. The real server retains native Remote behavior.

The gateway proxies native `/models` discovery, preserving every OpenAI metadata field and appending `muse/<id>` entries. OpenAI discovery remains live; Muse discovery refreshes every five minutes. Native model cache and picker refresh behavior still apply. A regular launch can briefly show cached Muse entries until its native catalog refresh completes. A stock launch does not retain the gateway URL.

OpenAI HTTP and WebSocket inference uses the original native authentication and upstream endpoint. The loopback gateway sees those requests in memory, adding a local dependency and another possible failure point. It forwards upstream errors, including a WebSocket authentication failure before accepting the native connection. It does not redirect credentials to another host or send OpenAI credentials to Muse. If the gateway fails, both model groups in that launch can fail. Fully quit and use the original icon to bypass it.

Muse requests use the configured bridge account or explicit key-file selection. Muse's own tools are disabled; validated tool decisions return to Codex for execution and approval. Provider switches preserve full input history, including bounded in-memory expansion for incremental Responses requests. Missing history, unsupported inputs, and unavailable Muse models produce explicit errors, never an automatic provider switch.

## Limits and Remote verification

- Live OpenAI → Muse → OpenAI turns passed on one ephemeral native task, using the existing ChatGPT and Muse account logins. A separate native fixture test verified a Muse → native shell tool → Muse round trip, one server PID, direct native RPCs returning the same catalog/task, private desktop defaults, and standard-launch recovery.
- **Actual desktop/phone Remote use and the mobile UI still need device verification after launching the companion app.** The shared architecture removes the earlier competing Remote processes, but it does not prove that every mobile build displays custom model IDs. No mobile application is patched.
- Desktop and mobile still obey native device ownership. This integration does not forcibly take a task away from another active device.
- Remote requests go directly to the native server. Remote settings writes therefore retain native persistence; the private desktop preference interceptor does not cover them. If a phone saves Muse as the global default, select an OpenAI default when using the stock app. Tasks saved with a Muse model likewise need an OpenAI selection to continue through the stock launcher. History is retained.
- Native task resume/fork behavior, account switching, expired-credential refresh, advanced desktop tools and automation still need broader acceptance coverage in this runtime. An earlier additive test passing does not validate the same behavior in the shared gateway.
- Muse supports text and Codex-executed tools. Images, audio, file inputs, native compaction and Responses Lite are unsupported. The optional OpenAI-hosted web search definition is omitted from Muse's tool choices; an explicitly required hosted search or other unsupported hosted tool fails. These restrictions do not alter OpenAI requests.
- WebSocket setup authenticates the native OpenAI connection before accepting the local connection, even for Muse. An OpenAI authentication failure or outage can therefore prevent Muse WebSocket startup. Muse generation itself still uses only the Muse login.
- The launcher does not add Muse to ordinary ChatGPT web/cloud conversations. The desktop host must be running and reachable for native Remote use.

## Verification commands

```sh
npm run check
MUSE_SHARED_NATIVE_TEST=1 node --test test/shared-native.test.mjs
```

The optional native test defaults to `/Applications/ChatGPT.app/Contents/Resources/codex`; set `MUSE_SHARED_TEST_CODEX` for another executable. It uses a temporary Codex home, synthetic account data and local fixture providers. It makes no paid model request or changes to the user's config. Gateway tests cover catalog metadata, gzip-compressed requests, HTTP/SSE forwarding, WebSockets, free connection warmup, cancellation, credential separation, upstream 401 propagation, provider switching, unknown models, and history bounds. macOS launcher tests verify process-only environment changes, cleanup, version refusal and LaunchServices compatibility.

The private live smoke script used during development lives under ignored `artifacts/`; it makes real generation requests and is not part of the default suite.

References: [built-in OpenAI base URL configuration](https://learn.chatgpt.com/docs/config-file/config-advanced#custom-model-providers), [app-server protocol](https://learn.chatgpt.com/docs/app-server).
