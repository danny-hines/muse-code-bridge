# Use Muse Code in your desktop agent

Share this page: **https://github.com/danny-hines/muse-code-bridge/blob/main/docs/setup.md**.

The installer is the supported setup path. Run it yourself or ask your desktop agent to run the same script. Each person signs in to their own Muse account; the repository contains no account credentials and needs no hosted relay.

**The working desktop integration is Muse as a collaborator through MCP tools and skills. Adding Muse alongside Astra/OpenAI models in the existing model picker is not implemented.** The experimental native adapter replaces the active provider and catalog when explicitly enabled, hiding the normal model options. Its protocol tests do not establish full desktop picker routing.

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

## Restore missing Astra/OpenAI model options

If you previously enabled native replacement mode, run this and then **fully quit and reopen Codex**:

```sh
"$HOME/.local/share/muse-bridge/runtime/bin/node" "$HOME/.local/share/muse-bridge/repo/dist/muse-native.mjs" disable
```

For a clone, use `node dist/muse-native.mjs disable` from that checkout. This restores the saved provider, catalog, model, effort, and search settings. The MCP plugin and skills remain installed. If you manually edited the managed provider settings, the helper stops rather than overwriting them; see [recovery details](native-provider.md#switching-back-and-updates).

Installing or updating the collaborator plugin does not automatically disable previously enabled replacement mode. Use the restore command first when returning to your previous provider. Start a new task after restarting so the provider and model selection agree.

## Experimental native adapter

On macOS, `--native` prepares and checks the local native service while preserving the current model/provider selection. It does **not** append Muse to the current picker. Activation requires a separate, explicit `--replace-provider` option and hides the normal model options. The direct helper likewise requires `enable --replace-provider`. See the [native guide](native-provider.md) before choosing replacement mode.

The adapter supports text and tool handoffs at the app-server level, with buffered replies. Images, screenshots, audio, and uploaded file inputs are unsupported. Full in-app browser, desktop feature compatibility, and desktop picker request routing remain unverified.

## Subscription or API

Account mode uses the official Muse CLI's saved credentials. Confirm Muse is using the credential connected during subscription onboarding. Stored API keys can take precedence over browser login, so successful setup alone cannot verify subscription billing. The bridge never extracts or shares subscription tokens. Each user needs their own eligible Muse access.

For explicit pay-as-you-go API access, save your own additional Meta Model API key in a private file outside the repository, set its permissions to `600`, and use:

```sh
curl -fsSL https://raw.githubusercontent.com/danny-hines/muse-code-bridge/main/bootstrap.sh | bash -s -- \
  --auth api-key --api-key-file "$HOME/.config/muse-code-bridge/meta-api-key"
```

This assumes the key file already exists. API mode skips account login; only the key-file path is saved. Both modes use the official Muse CLI today. See [authentication details](../README.md#login-and-subscription) and the [API/subscription/OpenCode comparison](access-options.md).

## Updates

Wait until active work finishes, then rerun the bootstrap. Omit `--auth` and use `--no-login` to keep your saved credential choice without signing in again. Add `--native` only to refresh the optional native service; this preserves the active model/provider selection. Restart the desktop app afterward. The installer refuses to replace locally modified source or conflicting managed settings.

This is an independent community project, not an official Meta or OpenAI desktop integration.
