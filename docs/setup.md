# Use Muse Code in your desktop agent

Share this page: **https://github.com/danny-hines/muse-code-bridge/blob/main/docs/setup.md**.

Use the installer for the Codex / ChatGPT desktop MCP plugin, then optionally add the experimental companion shortcut. **Hermes and OpenCode integrations are works in progress and currently untested in those hosts.** Each person signs in to their own Muse account; no credentials or hosted relay are included.

Choose the experience you want:

| Experience | Status | Setup |
|---|---|---|
| Keep the selected Codex model in charge; delegate to Muse through skills/tools | Tested locally on macOS | Bootstrap, then restart the host normally |
| Select Muse alongside OpenAI models in ChatGPT desktop | Experimental; native/live tests passed, mobile unverified | Bootstrap, then install ChatGPT + Muse.app |
| Use Muse through Hermes or OpenCode MCP | Work in progress; currently untested in-host | Development instructions in the host guides |

The companion shortcut uses a shared inference gateway and one native task server. Actual mobile Remote use, mobile picker visibility, and automatic visible catalog refresh still need verification. [Status and limits](shared-gateway-design.md#limits-and-remote-verification).

## Keep your model options and use Muse as a collaborator

Install your desktop app first, then run:

```sh
curl -fsSL https://raw.githubusercontent.com/danny-hines/muse-code-bridge/main/bootstrap.sh | bash -s -- --auth account --login
```

Complete Muse's official browser sign-in using the account connected to your subscription. Fully quit and reopen Codex, start a new **local** task, and enable **Muse Code Bridge** in the plugins picker. Ask:

> Use muse-implement for this task. Define the scope, let Muse implement and test, then review the diff and verify the result.

Your chosen host model keeps planning, using desktop tools, and verifying Muse's work. Muse has its own agent session; the host can pass it browser evidence or other relevant context.

The script downloads a source snapshot pinned to a commit, installs missing Node.js, Muse Code CLI, and Codex CLI privately, and registers the plugin and skills. No Git, Homebrew, sudo, manual JSON/TOML editing, or build step is required. It does not install the desktop app or a model into ordinary ChatGPT web chats or cloud tasks. Initial setup checks do not make a model generation request.

### Prefer to ask an agent?

Paste this into a local task whose agent can run terminal commands:

```text
Install Muse Code Bridge as a collaborator while keeping my current host model
and all existing model picker options. Follow
https://github.com/danny-hines/muse-code-bridge/blob/main/docs/setup.md
and run the account-mode bootstrap with --auth account --login.
Do not replace my model provider or catalog. Let me complete the official Muse
browser sign-in; do not ask me to paste credentials. Tell me how to restart the
app, enable the plugin, and invoke muse-implement or muse-review.
```

The agent runs the same installer and can help with errors. It does not need an existing Muse skill or plugin to read these setup instructions.

For the work-in-progress Hermes or OpenCode integrations, add `--host hermes` or `--host opencode`. These configure MCP tools and skills but are currently untested in the actual hosts. Native model-provider adapters are not implemented. See the [host guides](../README.md#install) and [skill catalog](skills.md).

## Select Muse directly in Codex / ChatGPT desktop (macOS, experimental)

Use the **ChatGPT + Muse companion shortcut** for the combined picker. It keeps the original ChatGPT icon available and uses a ChatGPT icon with a small Meta badge for the companion. The current installer accepts only the tested native executable, `codex-cli 0.154.0-alpha.6.2`.

After the bootstrap and Muse sign-in above, install the shortcut using bootstrap's private executables:

```sh
bridge_root="${MUSE_BRIDGE_ROOT:-$HOME/.local/share/muse-bridge}"
MUSE_BRIDGE_EXECUTABLE="$bridge_root/runtime/bin/muse" \
  "$bridge_root/runtime/bin/node" \
  "$bridge_root/repo/scripts/install-shared-macos.mjs" --dock
```

For an unmodified Git checkout with Node.js 22+ and Muse on your PATH, run `node scripts/install-shared-macos.mjs --dock` from the checkout instead. Committed bundles and icons are included; source changes require a build first. The installer does not launch or quit ChatGPT. [Full installation details and overrides](shared-gateway-design.md#install-and-use).

**Fully quit ChatGPT with Cmd+Q, then open ChatGPT + Muse.** No Terminal window needs to stay open. Select a Muse model from the picker; no Muse skill invocation is required. The selected model can request Codex tools, which Codex executes using its normal approvals. Let a turn finish or interrupt it before switching models.

The normal ChatGPT icon starts the standard runtime. The companion starts the same installed app with a process-scoped gateway URL; it does not replace global provider settings. OpenAI inference also passes through this gateway during that launch, adding a local dependency. Desktop model/effort defaults are private to the bridge; mobile settings writes retain native persistence. Read the [gateway tradeoffs and Remote limits](shared-gateway-design.md#limits-and-remote-verification).

To check the installed shortcut without launching it:

```sh
"$HOME/Applications/ChatGPT + Muse.app/Contents/MacOS/muse-launch" --check
```

This validates local files and the tested native version. It does not make a model request, verify billing, or test Remote. Muse accepts text and Codex tool handoffs; images/audio/file inputs, native compaction, and full browser/connector compatibility are not supported or verified as detailed in the gateway guide.

### Ask an agent to set up the combined picker

```text
Install the experimental ChatGPT + Muse companion app for my macOS desktop.
Follow https://github.com/danny-hines/muse-code-bridge/blob/main/docs/setup.md.
Use the account-mode bootstrap and let me complete Muse's official sign-in.
Install the shared-gateway shortcut alongside the original ChatGPT icon,
then run its --check. Preserve my native provider configuration and history.
Use the tested native version; do not bypass its compatibility check.
Tell me when to quit ChatGPT and switch icons. If this task runs inside
ChatGPT, leave it running until the setup work is finished.
```

### Return to the standard app or remove the bridge

Fully quit ChatGPT, then open the original icon to bypass the gateway. A task saved with Muse, or a Muse default saved remotely, may need an OpenAI selection to continue in the standard runtime; its history remains intact. An ordinary launch may briefly show cached Muse names until native model discovery refreshes.

To remove the companion, quit the app and remove `~/Applications/ChatGPT + Muse.app` and its Dock tile. Optional removal of its private payload and preferences is documented in the [gateway guide](shared-gateway-design.md#updates-and-removal). Removing the MCP plugin is a separate operation in the [Codex guide](../integrations/codex/README.md#update-and-remove). Do not remove shared source/runtime files while another host still uses them.

### Older launcher and provider-replacement installs

`scripts/launch-additive-macos.sh` is the **older local-only development launcher**, not the companion app. It requires its Terminal to stay open and disables Remote in all child servers. Its Muse tasks retain separate routing metadata in `additive/routes.json`; keep that metadata and follow its [legacy task and Remote recovery instructions](additive-development.md). The shared launcher does not automatically migrate those provider routes.

The retired `--native`, `--replace-provider`, and direct `enable` commands remain disabled. They are not setup steps for either current mode.

## Restore missing Astra/OpenAI model options

If you previously enabled native replacement mode, run this and then **fully quit and reopen Codex**:

```sh
"$HOME/.local/share/muse-bridge/runtime/bin/node" "$HOME/.local/share/muse-bridge/repo/dist/muse-native.mjs" disable
```

For a clone, use `node dist/muse-native.mjs disable` from that checkout. This restores the saved provider, catalog, model, effort, and search settings. The MCP plugin and skills remain installed. If you manually edited the managed provider settings, the helper stops rather than overwriting them; see [recovery details](native-provider.md#switching-back-and-updates).

Installing or updating the collaborator plugin does not automatically disable previously enabled replacement mode. Use the restore command first when returning to your previous provider. Start a new task after restarting so the provider and model selection agree.

## Subscription or API

Account mode uses the official Muse CLI's saved credentials and removes an inherited `META_API_KEY` from the Muse child process. Confirm the active account and plan in Muse; successful setup alone cannot verify subscription billing. The bridge never extracts or shares subscription tokens. Each user needs their own eligible Muse access.

For explicit pay-as-you-go API access, save your own additional Meta Model API key in a private file outside the repository, set its permissions to `600`, and use:

```sh
curl -fsSL https://raw.githubusercontent.com/danny-hines/muse-code-bridge/main/bootstrap.sh | bash -s -- \
  --auth api-key --api-key-file "$HOME/.config/muse-code-bridge/meta-api-key"
```

This assumes the key file already exists. API mode skips account login; only the key-file path is saved. Both modes use the official Muse CLI today. See [authentication details](../README.md#login-and-subscription) and the [API/subscription/OpenCode comparison](access-options.md).

## Updates

Wait until active work finishes. For the default Codex bootstrap installation, update with:

```sh
curl -fsSL https://raw.githubusercontent.com/danny-hines/muse-code-bridge/main/bootstrap.sh | bash -s -- --host codex --no-login
```

Omitting `--auth` preserves the saved account/API choice; `--no-login` avoids signing in again. Repeat your original host flags when updating multiple hosts. Keep any custom `MUSE_BRIDGE_ROOT` override on the `bash` process. Bootstrap uses a managed source snapshot, so rerun bootstrap rather than running `git pull` inside that directory. For a Git clone, use `git pull --ff-only` and rerun `./install.sh --host codex` (or your selected hosts); release bundles are committed, so an unmodified clone needs no build.

For the MCP plugin, fully quit and reopen the desktop app and start a new local task. For **ChatGPT + Muse**, rerun the companion installer above as well: it uses a versioned copy of the bundle, so pulling the repo or updating the MCP plugin alone does not update an installed shortcut. Then fully quit and launch the companion again. A chat restart does not replace a running server.

After a native ChatGPT app update, the companion refuses to run until that executable version is verified and supported by the installer. Use the original ChatGPT icon in the meantime. Reinstalling without a supported version does not bypass this check.

Bootstrap preserves private connection settings and refuses to replace locally modified source or conflicting host configuration. If the older additive script reports a worker limit, model-settings error, or Remote writer conflict, use its [development/recovery guide](additive-development.md). Opening the ordinary ChatGPT icon without Muse entries is expected; use the companion when you want the combined picker.

This is an independent community project, not an official Meta or OpenAI desktop integration.
