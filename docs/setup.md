# Use Muse Code in your desktop agent

Share this page: **https://github.com/danny-hines/muse-code-bridge/blob/main/docs/setup.md**.

The installer is the supported setup path. Run it yourself or ask your desktop agent to run the same script. Each person signs in to their own Muse account; the repository contains no account credentials and needs no hosted relay.

Choose the experience you want:

| Experience | Hosts | Setup |
|---|---|---|
| Keep Astra or another host model in charge; delegate to Muse through skills/tools | Codex / ChatGPT desktop, Hermes, OpenCode | Run bootstrap, then restart the host normally |
| Select Muse directly alongside the OpenAI models | Codex / ChatGPT desktop on macOS, experimental | Run bootstrap, then launch the app with the script below |

Both model groups and Muse selection have now been user-tested in the macOS desktop. Automatic GUI refresh when providers publish new models and broader desktop feature compatibility remain under test. Existing OpenAI provider settings are preserved in both workflows. [Status and limits](additive-models.md).

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

For Hermes or OpenCode, add `--host hermes` or `--host opencode`. Their supported integration is MCP tools and skills; their native model-provider integrations are not implemented. See the [host guides](../README.md#install) and [skill catalog](skills.md).

## Select Muse directly in Codex / ChatGPT desktop (macOS, experimental)

Run the bootstrap above first. It includes the compiled adapter and launcher, so no Git clone, npm build, or separate service installation is needed. If you already installed the bridge, use the update command below to fetch the current launcher.

After setup and Muse login, **fully quit Codex / ChatGPT desktop with Cmd+Q**. Then run:

```sh
"$HOME/.local/share/muse-bridge/repo/scripts/launch-additive-macos.sh"
```

Keep that terminal open while using the app. Start a new local chat and select a Muse model from the normal model picker. Your OpenAI models remain available there too. No skill invocation is required: the selected Muse model handles the chat and can request Codex tool calls. To change providers in an existing chat, finish or interrupt the current turn before selecting another model.

**Use this launcher each time you want both catalogs.** Opening the app normally uses the standard Codex runtime. The separate launcher does not change your Dock shortcut or install a background login service. Its model and reasoning preferences survive launcher restarts in a private bridge file; existing chats keep their own provider choices.

The launcher finds bootstrap's private Node and Muse executables automatically. The desktop app itself must already be installed at `/Applications/ChatGPT.app`; set `MUSE_ADDITIVE_APP_PATH` if it is elsewhere. For a Git clone, use `./scripts/launch-additive-macos.sh` from that checkout. For a custom bootstrap root, use that root's `repo/scripts/launch-additive-macos.sh`; it detects the managed root automatically.

Optional local prerequisite check, which can run while the app is open:

```sh
"$HOME/.local/share/muse-bridge/repo/scripts/launch-additive-macos.sh" --check
```

This checks the local app and executables. It does not make a model request or establish account/subscription access. Muse currently supports text and tool handoffs through the adapter; image/audio/file inputs and full browser/connector compatibility are not established. See [current limits](additive-development.md#limits-before-a-native-release).

### Ask an agent to set up the combined picker

```text
Set up the experimental combined OpenAI/Muse model picker for my macOS
Codex / ChatGPT desktop app. Follow
https://github.com/danny-hines/muse-code-bridge/blob/main/docs/setup.md
Use the standard account-mode bootstrap with --auth account --login, then
run the launcher's --check. Let me complete Muse's official sign-in.
Preserve my existing OpenAI provider and catalog. Give me the exact launcher
command and tell me when to quit the app before running it. If this task runs
inside that app, do not terminate it while the task is still running.
```

The retired `--native`, `--replace-provider`, and direct `enable` commands remain disabled. They belong to the old provider-replacement experiment and are not steps in this setup.

### Return to the standard app or remove the bridge

Fully quit the app, then reopen it normally to return to the standard runtime. To resume a Muse-primary chat, reopen through the launcher. Keep `additive/routes.json` while retaining those chats; deleting routing metadata prevents implicit Muse resume. The ordinary app cannot resume the custom Muse provider by itself.

Removing the MCP plugin is a separate step, covered in the [Codex guide](../integrations/codex/README.md#update-and-remove). You can retain the private preferences and routes for future use. Source/runtime files are shared with any Hermes or OpenCode installations, so remove them only after those integrations are removed too.

## Restore missing Astra/OpenAI model options

If you previously enabled native replacement mode, run this and then **fully quit and reopen Codex**:

```sh
"$HOME/.local/share/muse-bridge/runtime/bin/node" "$HOME/.local/share/muse-bridge/repo/dist/muse-native.mjs" disable
```

For a clone, use `node dist/muse-native.mjs disable` from that checkout. This restores the saved provider, catalog, model, effort, and search settings. The MCP plugin and skills remain installed. If you manually edited the managed provider settings, the helper stops rather than overwriting them; see [recovery details](native-provider.md#switching-back-and-updates).

Installing or updating the collaborator plugin does not automatically disable previously enabled replacement mode. Use the restore command first when returning to your previous provider. Start a new task after restarting so the provider and model selection agree.

## Subscription or API

Account mode uses the official Muse CLI's saved credentials. Confirm Muse is using the credential connected during subscription onboarding. Stored API keys can take precedence over browser login, so successful setup alone cannot verify subscription billing. The bridge never extracts or shares subscription tokens. Each user needs their own eligible Muse access.

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

Then fully quit and reopen the desktop app. **For the combined picker, reopen with the launcher command above.** A running adapter retains its loaded code; restarting only the chat does not update it. The installer preserves private connection/preferences/routes outside the managed source and refuses to replace locally modified source or conflicting host settings.

If an older build shows **“Couldn't update model settings”**, update and fully relaunch through the script. If only OpenAI models appear after a normal app launch, use the script to enable the combined picker for that session. If setup reports a lock, confirm the corresponding installer/runtime has exited before removing a stale lock; see [launcher troubleshooting](additive-development.md#temporary-desktop-test-on-macos).

This is an independent community project, not an official Meta or OpenAI desktop integration.
