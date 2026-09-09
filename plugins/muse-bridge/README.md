# Muse Bridge

Use your locally authenticated Muse Code as a collaborator inside ChatGPT desktop's local Work/Codex conversations. Ask for a second opinion, code review, competing approach, or coding task, then continue the same Muse conversation.

This is a working community plugin built against Muse Code **1.0.3 (1.0.3-R2198.1)** and MSP v1. It calls the official `muse serve` process. It does not replace the ChatGPT model or directly grant Muse access to ChatGPT's browser and tools. The host assistant can gather evidence with those tools, send relevant results to Muse, and evaluate its response.

## Install

Share this repository: **[github.com/danny-hines/muse-bridge](https://github.com/danny-hines/muse-bridge)**.

Run this on the computer where you use ChatGPT desktop:

```sh
curl -fsSL https://raw.githubusercontent.com/danny-hines/muse-bridge/main/bootstrap.sh | bash
```

The script fetches the repository and installs the desktop plugin. It reuses compatible tools already installed; when needed, it installs Node.js, the Codex CLI, and Muse Code in your home directory. **No Git, Homebrew, sudo, global npm install, or manual build is needed.**

Sign in to your own Muse account when prompted, then start a **new local conversation** in ChatGPT desktop and select **Muse Bridge**. If Muse is already installed, setup offers an optional login; otherwise, it runs Muse's official browser login after installation. ChatGPT desktop itself must already be installed and signed in.

macOS is verified. Linux is covered by mocked installer tests; its desktop integration has not been verified. Windows is not supported by this launcher. Standard system tools (`bash`, `curl`, `tar`, and a SHA-256 utility) are required.

### What the bootstrap does

1. Reuses Node.js 22+ or downloads a private Node.js 22 runtime from nodejs.org and verifies its published SHA-256 checksum.
2. Resolves the selected Git ref to a commit and downloads that source snapshot from GitHub.
3. Reuses a compatible Muse installation or runs Meta's official installer with a private install path and shell-profile changes disabled.
4. Reuses a Codex CLI with plugin support or installs the tested `@openai/codex@0.153.4` package under a private npm prefix.
5. Registers the repository marketplace and installs the plugin. It saves executable paths so the app can find them when launched from the Dock.

Files live under `~/.local/share/muse-bridge`: `repo/` holds the source snapshot and `runtime/` holds managed tools and links. Existing Muse sessions and bridge metadata stay in place. Bootstrap updates refuse to overwrite locally modified source files or an unrelated directory. Dependency downloads require internet access; Meta may require account login to download Muse itself.

To explicitly run login, or to skip optional login prompts:

```sh
curl -fsSL https://raw.githubusercontent.com/danny-hines/muse-bridge/main/bootstrap.sh | bash -s -- --login
curl -fsSL https://raw.githubusercontent.com/danny-hines/muse-bridge/main/bootstrap.sh | bash -s -- --no-login
```

`--no-login` does not bypass any authentication Meta requires for downloading or using Muse. To inspect the script before running it:

```sh
curl -fsSL https://raw.githubusercontent.com/danny-hines/muse-bridge/main/bootstrap.sh -o /tmp/muse-bridge-bootstrap.sh
less /tmp/muse-bridge-bootstrap.sh
bash /tmp/muse-bridge-bootstrap.sh
```

### Install from a clone

For contributors or people who already have Git, Node.js 22+, Muse Code 1.0.3+, and the Codex CLI:

```sh
git clone https://github.com/danny-hines/muse-bridge.git
cd muse-bridge
./install.sh
```

If you have not signed in to Muse yet, use `./install.sh --login` instead of the last command. This runs Muse's official browser login. If you are already signed in, the installer reuses that setup without opening another login flow. After cloning, macOS users can also double-click **Install.command** in Finder.

The checkout's `install.sh` checks prerequisites and registers this checkout as the `muse-bridge` marketplace. Unlike `bootstrap.sh`, it expects dependencies to be present. Keep the checkout at the same path for updates. To run checks without changing settings:

```sh
./install.sh --check
```

If another copy is already installed from a different marketplace, `install.sh` stops before changing plugin settings. Remove that copy in the desktop Plugins screen and rerun setup to switch sources. To switch between a clone and the bootstrap-managed source, remove the old `muse-bridge` marketplace first using the uninstall commands below. This retains Muse sessions and bridge metadata.

**Prefer to ask the desktop agent to install it?** Give it this repository URL and say:

> Read this repository's README and bootstrap script, then install Muse Bridge for me. Use my existing Muse login if available.

### Install directly as a GitHub marketplace

With the same prerequisites, you can skip cloning and the install script:

```sh
codex plugin marketplace add danny-hines/muse-bridge --ref main
codex plugin add muse-bridge@muse-bridge
```

The prebuilt MCP server is committed to the repository. Recipients do not need to compile it or run `npm install`.

## Use it

1. Start a **new local conversation** in the project you want Muse to work with. New plugin tools are picked up in new conversations.
2. Select Muse Bridge or invoke its `muse` skill, then ask:

   > Ask Muse to review my changes. Compare its findings with yours and verify the disagreements.

Other examples:

- “Have Muse propose another architecture for this feature.”
- “Send this plan to Muse for critique, then respond to its strongest objections.”
- “Use the browser to reproduce this UI bug, share the findings with Muse, and ask it to suggest a fix.”
- “Ask Muse to implement this fix in the current project, then review its diff.”

`consult`, `review`, and `compare` sessions disable Muse shell execution and file writes. `code` sessions retain Muse's sandbox and on-request approval policy. Muse can still read relevant workspace files and send them to Meta. Use `code` only for an implementation request. The bridge relays pending approvals and questions through the host conversation; it never enables blanket approvals or persistent policy changes.

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

## Update or uninstall

For a bootstrap installation, rerun the same one-line command. It reuses dependencies and replaces an unmodified source snapshot with the selected commit. Managed source snapshots are not Git checkouts. The default ref is `main`; set `MUSE_BRIDGE_REF` on the `bash` process to select a release tag or commit.

If you installed from a clone, run these commands in that checkout:

```sh
git pull --ff-only
./install.sh
```

If you installed directly as a GitHub marketplace:

```sh
codex plugin marketplace upgrade muse-bridge
codex plugin add muse-bridge@muse-bridge
```

After updating, start a new local conversation. To uninstall:

```sh
codex plugin remove muse-bridge@muse-bridge
codex plugin marketplace remove muse-bridge
```

Uninstalling does not delete your Muse installation, login, sessions, bridge metadata, or project files. You can delete your clone afterward.

For bootstrap installs, private tools and source remain under `~/.local/share/muse-bridge/runtime` and `~/.local/share/muse-bridge/repo`. Those two directories can be removed after uninstalling. Keep the rest of `~/.local/share/muse-bridge` if you want to retain bridge session metadata. Tools installed separately elsewhere are never removed by these commands.

## Troubleshooting

| Problem | What to do |
|---|---|
| `node`, `muse`, or `codex` is missing | Use the bootstrap command to install missing tools. For a manual checkout, `./install.sh --check` diagnoses prerequisites. |
| Muse login or eligibility error | Rerun bootstrap with `--login`, or run your Muse CLI's `login` command and check the account/plan. |
| Plugin installed but tools are missing | Start a new **local** desktop conversation and enable Muse Bridge. Restart the desktop app if the catalog has not refreshed. |
| Already installed from `personal` or another marketplace | Remove that copy from the Plugins screen before switching to the repository installation. |
| `sessionInUse` | Close or release that session in its other Muse host before resuming here. |
| Tools work in Terminal but not from the Dock | Rerun bootstrap to save working executable paths. The launcher also checks common Homebrew and `~/.local/bin` paths. |
| Bootstrap says source files changed | Preserve your edits before updating. For ongoing development, use a separate Git clone. |
| An earlier setup was interrupted | Confirm it has stopped, then remove the empty `~/.local/share/muse-bridge/.bootstrap-lock` directory and rerun. |

The installers accept `MUSE_BRIDGE_NODE_BIN`, `MUSE_BRIDGE_CODEX_BIN`, and `MUSE_BRIDGE_EXECUTABLE` as executable paths. Bootstrap persists the selected paths as managed symlinks; the checkout installer alone does not. `MUSE_BRIDGE_ROOT` overrides the bootstrap's local root; if changed, that same environment setting must be available to the desktop app's plugin launcher. The default root needs no environment configuration.

## Distribution

Share the GitHub repository URL. Everyone installs the plugin locally and signs in to their own Muse account. This is repository distribution, separate from the universal public plugin directory. A hosted service is not needed for this local integration.

## Develop

```sh
npm ci --ignore-scripts
npm test
npm run build
npm run smoke
```

`npm run smoke` only performs a protocol handshake and model discovery. To deliberately consume Muse usage for a two-turn connection and memory check:

```sh
node scripts/smoke.mjs --live
```

The build bundles the supported MCP TypeScript SDK v1 into `plugins/muse-bridge/scripts/server.mjs`. Source lives in `src/`; the standalone plugin is in `plugins/muse-bridge/`. `.agents/plugins/marketplace.json` makes the repository installable as a plugin marketplace. Tests cover the bridge, transport, checkout installer, and curl bootstrap with temporary directories, fake downloads, and mock CLIs. `scripts/verify-mcp.mjs` checks the actual bundle through the official MCP client and requires a real Muse installation.

After changing source, run `npm run check` and commit the regenerated plugin files along with your source changes. CI verifies that the checked-in bundle matches the source. Bump the plugin and package versions for distributed releases so installed copies refresh correctly.

Optional environment settings:

- `MUSE_BRIDGE_EXECUTABLE`: explicit path to the official Muse executable.
- `MUSE_BRIDGE_DATA_DIR`: directory for bridge session metadata; default `~/.local/share/muse-bridge`.

Muse retains its own session logs. Bridge metadata contains session IDs, project paths, role, and model, stored as private local files. The plugin reads no credential files. CLI stderr is not forwarded into tool results. Diagnostic model errors can still include contextual information supplied by Muse.

## Architecture and sources

```text
ChatGPT desktop conversation + host tools
                │ MCP over stdio
                ▼
       Muse Bridge local server
                │ MSP over stdio
                ▼
         Official Muse CLI
                │ Muse-managed authentication
                ▼
              Meta
```

The local Muse binary's `--help`, `serve --help`, `login --help`, and offline `schema generate-ts` are the primary protocol references for this implementation.

- [OpenAI: Plugins in ChatGPT and Codex](https://learn.chatgpt.com/docs/plugins)
- [OpenAI: Package and distribute plugins](https://developers.openai.com/codex/plugins/build)
- [OpenAI: Connect and test plugins](https://developers.openai.com/plugins/deploy/connect-chatgpt)
- [MCP TypeScript SDK](https://github.com/modelcontextprotocol/typescript-sdk)
- [Official Muse Code product page](https://developer.meta.com/ai/lp/muse-code/)

Independent community integration; not affiliated with Meta or OpenAI.
