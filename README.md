# Muse Code Bridge

Call Muse Code from **Codex / ChatGPT desktop**, using your Muse Code subscription or an explicit pay-as-you-go API key. Ask for an independent code review, compare approaches, or delegate an implementation, then continue the same Muse conversation. **Hermes and OpenCode integrations are works in progress and currently untested in those hosts.**

Choose between Muse as a collaborator through MCP tools and skills, or the experimental **combined OpenAI/Muse model picker on macOS**. The [ChatGPT + Muse companion shortcut](docs/shared-gateway-design.md) uses one native task server and a local model gateway. The original ChatGPT icon remains available for ordinary launches. Live provider switching and native tool handoffs have passed; actual mobile Remote behavior and automatic GUI picker refresh remain unverified.

Community integration requiring Muse Code **1.0.3+** and Muse Session Protocol v1. The shared launcher is currently limited to the tested desktop executable, **`codex-cli 0.154.0-alpha.6.2`**. This repository contains no credentials and no hosted relay.

The included skills define two responsibility splits: **`muse-implement`** lets Muse implement and test while the host scopes and verifies; **`muse-review`** lets Muse critique while the host verifies findings and owns fixes. The shared **`muse`** skill supports consultation and session handling. See the [skill catalog, installation, and usage](docs/skills.md).

Codex bundles the complete collection. The work-in-progress Hermes/OpenCode installers accept `--skills implement`, `--skills review`, or `--skills all`. Omit the flag to preserve the previous selection on updates (all on a fresh installation). `--list-skills` lists the catalog without contacting Muse.

## Install

Repository: [danny-hines/muse-code-bridge](https://github.com/danny-hines/muse-code-bridge).

**New here? Share the [quick setup guide](docs/setup.md)**. It includes a one-command install, copy-ready prompts for an agent, and instructions for switching back.

The bootstrap installs MCP tools, skills, dependencies, and the source/bundles needed by the companion shortcut. It does not install the shortcut or activate the combined picker automatically. Legacy provider-replacement commands remain disabled. If an earlier installation hid your models, follow the [recovery instructions](docs/native-provider.md#switching-back-and-updates).

For **Muse as a collaborator**, run on the computer where you use your host app. Codex is the default:

```sh
curl -fsSL https://raw.githubusercontent.com/danny-hines/muse-code-bridge/main/bootstrap.sh | bash -s -- --auth account --login
```

For the **two-shortcut setup**, follow [ChatGPT + Muse installation](docs/shared-gateway-design.md#install-and-use) after bootstrap or from a checkout. The companion icon uses the ChatGPT logo with a Meta badge. Fully quit the app before switching icons; no Terminal window is needed while using it. OpenAI inference also passes through the local gateway in that launch. A full quit followed by the original icon bypasses it; saved Muse tasks or a remotely saved Muse default may need an OpenAI selection.

The [older additive launcher](docs/additive-development.md) remains available for local development only. It disables Remote to prevent competing child servers and task writer locks. It is not the companion shortcut. See [Remote recovery](docs/additive-development.md#remote-loading-and-open-in-another-app) for affected older sessions.

For the **work-in-progress, currently untested Hermes/OpenCode integrations**, select a host or repeat `--host`:

```sh
curl -fsSL https://raw.githubusercontent.com/danny-hines/muse-code-bridge/main/bootstrap.sh | bash -s -- --host hermes
curl -fsSL https://raw.githubusercontent.com/danny-hines/muse-code-bridge/main/bootstrap.sh | bash -s -- --host opencode
curl -fsSL https://raw.githubusercontent.com/danny-hines/muse-code-bridge/main/bootstrap.sh | bash -s -- --host codex --host hermes --host opencode
```

The bootstrap fetches a commit-pinned source snapshot, reuses compatible tools, and installs missing Node.js 22+ and Muse Code locally. **Only a Codex install checks or installs the Codex CLI.** No Git, Homebrew, sudo, global npm install, or build step is required. The desktop apps themselves must already be installed. Sign in to your own Muse account through the official browser flow when prompted.

Use `--login` to run login explicitly or `--no-login` to skip optional login. Meta may still require authentication to download or use Muse. OpenCode's version is detected from its CLI or existing MCP configuration; if unavailable, pass `--opencode-version 1` or `--opencode-version 2` for the beta.

| Host / mode | Status | Details |
|---|---|---|
| Codex / ChatGPT desktop MCP | Tested locally on macOS | [Plugin, tools and skills](integrations/codex/README.md) |
| ChatGPT + Muse model picker | Experimental; native/live checks passed, mobile unverified | [Companion shortcut](docs/shared-gateway-design.md) |
| Hermes MCP | Work in progress; currently untested in Hermes | [Development setup](integrations/hermes/README.md) |
| OpenCode 1 / 2 MCP | Work in progress; currently untested in OpenCode | [Development setup](integrations/opencode/README.md) |

After installing collaborator mode, restart the selected host and start a new **local** conversation in your project. For Codex, fully quit the app (Cmd+Q on macOS) and reopen it, then enable **Muse Code Bridge** in the plugins picker. Ask:

> Ask Muse to review my changes. Compare its findings with yours and verify the disagreements.

Other examples:

- “Have Muse propose another architecture for this feature.”
- “Send this plan to Muse for critique, then respond to its strongest objections.”
- “Use the browser to reproduce this UI bug, share the findings with Muse, and ask it to suggest a fix.”
- “Ask Muse to implement this fix in the current project, then review its diff.”

`consult`, `review`, and `compare` disable Muse's shell and file writes. `code` retains Muse's sandbox and approval policy. The host relays pending approvals and questions. Muse can read relevant workspace content; each user controls their own Muse account and settings.

### Install from a clone

With Node.js 22+, Muse Code 1.0.3+, and the Codex CLI if selecting Codex:

```sh
git clone https://github.com/danny-hines/muse-code-bridge.git
cd muse-code-bridge
./install.sh --host codex
# Or:
./install.sh --host hermes --host opencode --opencode-version 1
```

Add `--check` for a read-only preflight or `--login` for Muse login. macOS users can double-click `Install.command` for the default Codex installation. Keep the checkout in place; hosts reference it.

### Local files and updates

The bootstrap keeps source at `~/.local/share/muse-bridge/repo` and managed dependencies under `runtime/`. This established path is retained across the project rename so existing session metadata stays available. Reruns refuse to overwrite modified source, unrelated directories, or conflicting host entries. Hermes/OpenCode config changes create private backups and preserve unrelated settings and comments.

Rerun the bootstrap to update, using `--no-login` and omitting `--auth` to preserve the current credential choice. For a Git clone, use `git pull --ff-only` and `./install.sh --host …`. For ChatGPT + Muse, **rerun the companion installer too**, then fully quit and relaunch it: the shortcut uses its own versioned bundle copy. Native app updates need compatibility verification before reinstalling the companion. Native replacement flags remain withdrawn; use recovery if an earlier version replaced your provider. Multiple host installations share one runtime/source location. Include every host you want to reconfigure when updating runtime paths. Removal instructions are in each host guide; don't remove shared source/runtime files while another host uses them.

After updating, wait for current work to finish and fully quit and reopen your host. Existing Codex conversations can retain the old bridge server despite newer files being installed. `muse_status` reports the actual running `bridge_version`, `bridge_build`, and `bridge_started_at` for troubleshooting; older releases omit these diagnostics.

`MUSE_BRIDGE_REF` chooses a Git ref (default `main`); set it on the `bash` process. `MUSE_BRIDGE_ROOT` changes the managed root; for Codex, that setting must also reach the desktop plugin launcher. Executable overrides are `MUSE_BRIDGE_NODE_BIN`, `MUSE_BRIDGE_EXECUTABLE`, `MUSE_BRIDGE_CODEX_BIN`, and `MUSE_BRIDGE_OPENCODE_BIN`. Hermes/OpenCode config destinations can be set with `MUSE_BRIDGE_HERMES_CONFIG` and `MUSE_BRIDGE_OPENCODE_CONFIG`. The configuration tools never print existing credentials.

To inspect the bootstrap before executing it:

```sh
curl -fsSL https://raw.githubusercontent.com/danny-hines/muse-code-bridge/main/bootstrap.sh -o /tmp/muse-code-bridge-bootstrap.sh
less /tmp/muse-code-bridge-bootstrap.sh
bash /tmp/muse-code-bridge-bootstrap.sh --host codex
```

## Login and subscription

Setup supports two explicit authentication choices:

| Choice | Setup | Credential used by the official Muse CLI |
|---|---|---|
| Muse-managed account (default) | `--auth account`, optionally `--login` | Existing Muse credentials, including the credential connected during subscription onboarding |
| Pay-as-you-go API | `--auth api-key --api-key-file /absolute/private/file` | An additional Meta Model API key you supply; no subscription required |

Omitting `--auth` preserves the saved choice on updates. Both modes run the official Muse Code CLI. This is not a raw API proxy. No OpenAI API key is needed for the bridge; your host's own model usage is separate.

The bridge leaves Muse's credential store intact and does not extract subscription tokens. Account mode removes inherited `META_API_KEY`; explicit API mode supplies the selected key file's value to Muse. Stored credentials and the active Muse account still determine entitlement, so account mode cannot independently guarantee subscription billing. Confirm the intended plan in Muse and consult the current [subscriptions](https://dev.meta.ai/docs/muse-code/subscriptions) and [authentication](https://dev.meta.ai/docs/muse-code/auth) documentation.

A successful request establishes that the official Muse CLI route works. It **does not independently establish which billing entitlement Muse used**. The protocol's model catalog is not an account/subscription-status endpoint. Check your active plan and any stored provider configuration in Muse. The status tool reports this distinction explicitly.

Each person uses their own Muse account. Sharing the plugin shares no credentials, sessions, account configuration, or subscription. Prompts and any context Muse reads are processed under the user's Muse settings and terms.

### Use an API key

Create an additional pay-as-you-go key in your [Meta Model API account](https://dev.meta.ai/). Save only that key in a file outside the repository, for example `~/.config/muse-code-bridge/meta-api-key`. Keep it private with `chmod 600` and install:

```sh
chmod 600 "$HOME/.config/muse-code-bridge/meta-api-key"
curl -fsSL https://raw.githubusercontent.com/danny-hines/muse-code-bridge/main/bootstrap.sh | bash -s -- \
  --host codex --auth api-key --api-key-file "$HOME/.config/muse-code-bridge/meta-api-key"
```

Use the same flags with `./install.sh`, or select Hermes/OpenCode with `--host`. To change just authentication later, run `node dist/configure-auth.mjs --auth …` from the checkout. To return to Muse-managed credentials, use `--auth account`. Restart every host using the bridge after changing the choice or rotating the key.

Only the mode and key-file path are saved in `~/.local/share/muse-bridge/connection.json`. The key stays in your private file and is read at server startup, then passed to the Muse child as `META_API_KEY`; it is never placed in command arguments or host configuration. API mode ignores any different inherited key, skips optional account login, and fails if the selected file is missing or unsafe. It never falls back to another credential route. Existing sessions require their original authentication mode when resumed; this pins the mode, not the identity or entitlement of the Muse account.

The choice is shared across hosts using that connection file. Advanced setups can set `MUSE_BRIDGE_CONNECTION_FILE` to a separate absolute path in each host's MCP environment; `MUSE_BRIDGE_ROOT` also relocates the default file. A shell-only override will not automatically reach a desktop process. Keep keys outside managed source, and never put them in a prompt or commit them.

Choosing API authentication does **not** choose a Contributor model. Ask the host to use the exact Contributor model ID returned by `muse_status` if that is what you want; omitted models use Muse's default. Contributor data-use terms still apply. See the [subscription, API, and OpenCode comparison](docs/access-options.md) for billing distinctions and links to current provider terms and prices.

## Tools

| Tool | Purpose |
|---|---|
| `muse_status` | Check CLI compatibility and discover models without a model turn |
| `muse_start` | Start a persistent consultation, review, comparison, or coding session |
| `muse_poll` | Collect the current turn's output, completion, errors, or pending decisions |
| `muse_send` | Continue the same Muse session |
| `muse_sessions` | Find sessions created by this bridge |
| `muse_cancel` | Interrupt the current turn; existing edits are retained |
| `muse_decide` | Resolve a pending approval using a one-time choice |
| `muse_answer` | Relay answers to Muse's clarification questions |

Starts and follow-ups return quickly. Polls wait at most 20 seconds; the host collects results and displays them in the conversation. Each turn has a ten-minute limit and is interrupted when the limit is reached. The MCP connection must remain alive while work runs. Closing the host process ends active work; durable Muse conversations can be resumed later. A session held by another Muse host must be released there before it can be resumed here.

Current-turn MCP output is bounded (up to 80 items and about 60,000 characters). Long individual messages are explicitly truncated. If Muse supplies only paged history, `history_partial` is true. The bridge deliberately excludes reasoning items. The MCP plugin does not add a dedicated Muse chat panel, token-by-token host UI, automatic debate loop, direct browser-tool forwarding, cloud relay, or model-picker registration. See the separate experimental provider below.

## Architecture and provider support

```text
src/                         Shared Muse protocol client, sessions, MCP tools
integrations/codex/          Codex installer and usage guide
integrations/hermes/         Hermes integration guide
integrations/opencode/       OpenCode integration guide
plugins/muse-codex-bridge/   Standalone Codex plugin package
scripts/configure-host.mjs   Hermes YAML and OpenCode JSONC configuration
scripts/prepare-bootstrap.mjs Managed source/runtime setup
bootstrap.sh                 Dependency bootstrap and host selection
install.sh                   Checkout installer and host preflight
```

The build produces the shared MCP server, configuration helpers, `dist/muse-shared.mjs`, and `dist/muse-launch.mjs`, plus the same MCP server inside the Codex plugin. The MCP connection and the launcher's gateway run locally; no separately installed gateway login service is required.

**The combined picker is experimental and opt-in.** The [shared launcher](docs/shared-gateway-design.md) keeps desktop and native Remote on one Codex task server and routes inference by model ID. OpenAI requests retain native authentication; Muse uses the bridge's configured CLI authentication. Muse supports text and tool handoffs with buffered responses. Desktop model/effort defaults stay private to the bridge; Remote settings retain native persistence. The older [additive workers](docs/additive-development.md) and [standalone protocol service](docs/native-provider.md) remain documented separately for development and recovery.

Native model-provider adapters for Hermes and OpenCode are not implemented. Their MCP integrations are works in progress and currently untested in the actual hosts; generated configuration and direct MCP checks are not host acceptance tests.

## Validation and supported systems

The MCP shell installers target macOS and Linux, arm64 and x64. They need `bash`, `curl`, `tar`, and a SHA-256 utility. The companion app and both model-picker launchers are macOS-only. These installers do not support Windows.

- The official Muse process has passed a real two-turn conversation and session-resume check on macOS.
- The bundled MCP server is verified through an MCP SDK client; the Codex plugin is installed locally.
- Automated tests cover the protocol, authentication separation, session resumes, and installers, including OpenCode 1 and 2 layouts. Hermes/OpenCode launch commands have connected through an MCP SDK client, but **Hermes and OpenCode remain works in progress and currently untested in-host**: discovery, approvals, skills, and real tasks need acceptance checks there.
- The shared gateway passed a live OpenAI → Muse → OpenAI task on September 13, 2026. Native fixture tests cover one task server, a Muse/native-tool round trip, model discovery and standard-launch recovery. Actual desktop/phone Remote use and visible automatic picker refresh remain unverified.
- API credential handling is tested with fake keys and processes; no paid API request has been used to validate that mode.
- Fresh dependency installation is tested with download/process fixtures. [GitHub CI](https://github.com/danny-hines/muse-code-bridge/actions/workflows/ci.yml) builds and tests on macOS and Linux.

## Develop

```sh
npm ci --ignore-scripts
npm run check
npm run smoke
node scripts/verify-mcp.mjs
node scripts/verify-hosts.mjs
```

The smoke command only performs a handshake and model discovery. `node scripts/smoke.mjs --live` deliberately consumes Muse usage for a two-turn check. Automated tests use temporary config paths and fixture providers; optional native tests run the installed Codex executable against those fixtures. See [shared gateway verification](docs/shared-gateway-design.md#verification-commands). Commit rebuilt `dist/` and plugin files so an unmodified checkout needs no dependency installation or build just to use the bundled tools.

## Troubleshooting

- Missing tools: use bootstrap, or run `./install.sh --host … --check` to diagnose a checkout.
- Missing tools in the host: restart it, open a new local conversation, and enable the plugin/MCP entry. Project or managed settings may override global configuration.
- OpenCode version cannot be detected: pass `--opencode-version 1` or `2` explicitly.
- Conflicting host entry: preserve your existing entry and remove or rename it before installing. The installer will not overwrite it.
- Prototype Codex plugin already installed: follow the migration commands in the Codex guide.
- Login/eligibility failure: run the official `muse login` flow and inspect the account in Muse.
- `sessionInUse`: release that conversation in its other host before resuming; don't kill unrelated Muse processes.
- Interrupted setup: confirm no installer is running, then remove its stale `.bootstrap-lock` directory or the named config lock file before retrying.
- Modified managed source: preserve your edits before updating; use a separate Git clone for development.

## License

MIT. See [LICENSE](LICENSE). Bundled dependency notices are included in `dist/THIRD_PARTY_NOTICES.txt` and the Codex plugin. This is an independent community project, not an official Meta, OpenAI, Nous Research, or OpenCode integration.
