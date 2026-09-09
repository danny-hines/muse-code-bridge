# Muse Code Bridge

Call your locally authenticated Muse Code from **Codex / ChatGPT desktop, Hermes, or OpenCode**. Ask for an independent code review, compare approaches, or delegate an implementation, then continue the same Muse conversation.

One shared MCP server connects to the official `muse serve` process. Each host gets its own installer and instructions. **Muse is a collaborator, not a new entry in your host's model picker.** The host keeps its own model and tools, and can pass browser findings, code, and critiques to Muse.

Community integration, built against Muse Code **1.0.3 (1.0.3-R2198.1)** and Muse Session Protocol v1. This repository contains no credentials and no hosted relay.

## Install

Repository: [danny-hines/muse-code-bridge](https://github.com/danny-hines/muse-code-bridge).

**Publication status:** the repository is prepared locally; the GitHub links and curl commands become usable after publication.

Run on the computer where you use your host app. Codex is the default:

```sh
curl -fsSL https://raw.githubusercontent.com/danny-hines/muse-code-bridge/main/bootstrap.sh | bash
```

Select another host, or repeat `--host` to install several:

```sh
curl -fsSL https://raw.githubusercontent.com/danny-hines/muse-code-bridge/main/bootstrap.sh | bash -s -- --host hermes
curl -fsSL https://raw.githubusercontent.com/danny-hines/muse-code-bridge/main/bootstrap.sh | bash -s -- --host opencode
curl -fsSL https://raw.githubusercontent.com/danny-hines/muse-code-bridge/main/bootstrap.sh | bash -s -- --host codex --host hermes --host opencode
```

The bootstrap fetches a commit-pinned source snapshot, reuses compatible tools, and installs missing Node.js 22+ and Muse Code locally. **Only a Codex install checks or installs the Codex CLI.** No Git, Homebrew, sudo, global npm install, or build step is required. The desktop apps themselves must already be installed. Sign in to your own Muse account through the official browser flow when prompted.

Use `--login` to run login explicitly or `--no-login` to skip optional login. Meta may still require authentication to download or use Muse. OpenCode's version is detected from its CLI or existing MCP configuration; if unavailable, pass `--opencode-version 1` or `--opencode-version 2` for the beta.

| Host | Integration | Details |
|---|---|---|
| Codex / ChatGPT desktop | `muse-codex-bridge` plugin, MCP tools, Muse skill | [Setup and usage](integrations/codex/README.md) |
| Hermes | `mcp_servers.muse_code_bridge` | [Setup and usage](integrations/hermes/README.md) |
| OpenCode 1 / 2 beta | Version-aware `muse_code_bridge` MCP entry | [Setup and usage](integrations/opencode/README.md) |

After installation, restart the selected host and start a new **local** conversation in your project. In Codex, enable **Muse Code Bridge** in the plugins picker. Ask:

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

Rerun the same bootstrap command to update, or use `git pull --ff-only` and `./install.sh --host …` for a clone. Multiple host installations share one runtime/source location. Include every host you want to reconfigure when updating runtime paths. Removal instructions are in each host guide; don't remove shared source/runtime files while another host uses them.

`MUSE_BRIDGE_REF` chooses a Git ref (default `main`); set it on the `bash` process. `MUSE_BRIDGE_ROOT` changes the managed root; for Codex, that setting must also reach the desktop plugin launcher. Executable overrides are `MUSE_BRIDGE_NODE_BIN`, `MUSE_BRIDGE_EXECUTABLE`, `MUSE_BRIDGE_CODEX_BIN`, and `MUSE_BRIDGE_OPENCODE_BIN`. Hermes/OpenCode config destinations can be set with `MUSE_BRIDGE_HERMES_CONFIG` and `MUSE_BRIDGE_OPENCODE_CONFIG`. The configuration tools never print existing credentials.

To inspect the bootstrap before executing it:

```sh
curl -fsSL https://raw.githubusercontent.com/danny-hines/muse-code-bridge/main/bootstrap.sh -o /tmp/muse-code-bridge-bootstrap.sh
less /tmp/muse-code-bridge-bootstrap.sh
bash /tmp/muse-code-bridge-bootstrap.sh --host codex
```

## Login and subscription

Muse owns authentication, plan eligibility, billing, and usage limits. Sign in using the official `muse login` browser flow. No OpenAI API key is needed for this bridge. It removes inherited `META_API_KEY` before launching Muse because the CLI documents that variable as overriding account login. The bridge does not extract tokens or implement a separate API-key fallback.

A successful request establishes that the official Muse CLI route works. It **does not independently establish which billing entitlement Muse used**. The protocol's model catalog is not an account/subscription-status endpoint. Check your active plan and any stored provider configuration in Muse. The status tool reports this distinction explicitly.

Each person uses their own Muse account. Sharing the plugin shares no credentials, sessions, account configuration, or subscription. Prompts and any context Muse reads are processed under the user's Muse settings and terms.

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

Current-turn output is bounded (up to 80 items and about 60,000 characters). Long individual messages are explicitly truncated. If Muse supplies only paged history, `history_partial` is true. The bridge deliberately excludes reasoning items. There is no dedicated Muse chat panel, token-by-token host UI, automatic debate loop, direct browser-tool forwarding, cloud relay, or native model-picker integration in this release.

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

The build produces `dist/muse-server.mjs`, a bundled host configuration helper, and the same MCP server inside the Codex package. Host configuration uses absolute executable paths; no API service needs to stay running outside the host.

**Native provider mode is not implemented.** Codex [custom model providers](https://learn.chatgpt.com/docs/config-file/config-advanced#custom-model-providers), Hermes [external-process provider plugins](https://hermes-agent.nousresearch.com/docs/developer-guide/model-provider-plugin#external-process-acp-providers), and OpenCode [custom providers](https://opencode.ai/docs/providers/#custom-provider) are separate integration surfaces. A future adapter would need to translate messages, streaming, tool calls/results, and cancellation while preserving Muse's official authentication path. A working MCP bridge does not establish that native provider mode or desktop model-picker registration works.

## Validation and supported systems

The shell installers target macOS and Linux, arm64 and x64. They need `bash`, `curl`, `tar`, and a SHA-256 utility. Windows is not supported by this launcher.

- The official Muse process has passed a real two-turn conversation and session-resume check on macOS.
- The bundled MCP server is verified through an MCP SDK client; the Codex plugin is installed locally.
- All 39 automated tests pass. Hermes/OpenCode configuration and installer paths are exercised in isolated tests, including OpenCode 1 and 2 layouts. Their generated launch commands have also connected to the real Muse CLI through an MCP SDK client. Those desktop apps have not been exercised end to end.
- Fresh dependency installation is tested with download/process fixtures. GitHub CI is configured for macOS and Linux; it has not run until publication.

## Develop

```sh
npm ci --ignore-scripts
npm run check
npm run smoke
node scripts/verify-mcp.mjs
node scripts/verify-hosts.mjs
```

The smoke command only performs a handshake and model discovery. `node scripts/smoke.mjs --live` deliberately consumes Muse usage for a two-turn check. Tests use temporary config paths and fake CLIs; they never overwrite your live host configuration. Commit rebuilt `dist/` and plugin files so recipients don't need npm or a build.

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
