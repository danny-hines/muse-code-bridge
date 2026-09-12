# Use Muse Code in your desktop agent

Share this page: **https://github.com/danny-hines/muse-code-bridge/blob/main/docs/setup.md**.

The installer is the supported setup path. You can run it yourself or ask your desktop agent to run the same script. Each person signs in to their own Muse account; the repository contains no account credentials and needs no hosted relay.

## Choose your setup

| What you want | Choose |
|---|---|
| Muse is the main model for a new local Codex task | Native mode below; experimental, automatic setup on macOS |
| Astra or your current model plans and verifies while Muse implements or reviews | Collaborator mode; Codex, Hermes, or OpenCode on macOS/Linux |

Install your desktop app first. The bridge does not install the GUI app. The Codex instructions target its local agent configuration and plugin system; they do not install a model into ordinary ChatGPT web chats or cloud tasks.

## Muse as the main Codex model

1. Open Terminal on your Mac and paste:

   ```sh
   curl -fsSL https://raw.githubusercontent.com/danny-hines/muse-code-bridge/main/bootstrap.sh | bash -s -- --native --auth account --login
   ```

2. Complete Muse's official browser sign-in using the account connected to your subscription.
3. Fully quit Codex (Cmd+Q), reopen it, and start a new **local** task. Select a discovered Muse model in the model picker.

The script downloads a source snapshot pinned to a commit, installs missing Node.js, Muse Code CLI, and Codex CLI privately, registers the Muse plugin, starts a local service, discovers available models, and checks service health. It saves your previous model/provider settings before selecting Muse. No Git, Homebrew, sudo, manual JSON/TOML editing, API key, or build step is required. Initial setup checks do not make a model generation request.

Try this in a scratch project:

> Use the terminal to create a small text file, read it back, and report what you verified.

Actual Codex tool calls should appear. You do not need to invoke a Muse skill when Muse is the main model.

**Native mode is experimental.** It selects a separate provider configuration for new tasks; it does not provide a combined Astra/Muse menu with seamless routing. It supports text and tool handoffs, with buffered replies. Images, screenshots, audio, and uploaded file inputs are unsupported; full in-app browser and desktop feature compatibility is unverified. See [the native guide](native-provider.md) for details and test evidence.

### Prefer to ask an agent?

Paste this into a local Codex task whose agent can run terminal commands:

```text
Set up Muse Code Bridge on this Mac so Muse is the primary model for new local
Codex tasks. Follow https://github.com/danny-hines/muse-code-bridge/blob/main/docs/setup.md
and run its native account-mode bootstrap command with --native --auth account
--login. Use the repo's installer to preserve my existing configuration. Let me
complete Muse's official browser sign-in; do not ask me to paste credentials.
Check the local service health, then tell me how to restart Codex, select Muse,
and restore my previous model. Leave restarting the app to me.
```

The prompt is a convenience: your agent runs the same installer and can help with errors. It does not require an existing Muse skill or plugin to discover the setup instructions.

### Restore your previous Codex model

Run this, then fully quit and reopen Codex:

```sh
"$HOME/.local/share/muse-bridge/runtime/bin/node" "$HOME/.local/share/muse-bridge/repo/dist/muse-native.mjs" disable
```

The installer also prints this command using your actual installation path. The Muse collaborator plugin and skills remain installed. If you manually edited the managed provider settings, the helper stops rather than overwriting them; see [recovery details](native-provider.md#switching-back-and-updates).

## Muse as a collaborator

Use this when you want Astra or your current host model to keep planning, using desktop tools, and verifying Muse's work:

```sh
curl -fsSL https://raw.githubusercontent.com/danny-hines/muse-code-bridge/main/bootstrap.sh | bash -s -- --auth account --login
```

Complete Muse sign-in, fully quit and reopen Codex, and enable **Muse Code Bridge** in the plugins picker for a new local task. Ask:

> Use muse-implement for this task. Define the scope, let Muse implement and test, then review the diff and verify the result.

Or ask an existing agent:

```text
Install Muse Code Bridge as a collaborator while keeping my current host model.
Follow https://github.com/danny-hines/muse-code-bridge/blob/main/docs/setup.md
and run the account-mode bootstrap with --auth account --login, without --native.
Let me complete the official Muse browser sign-in. Tell me how to restart the
app, enable the plugin, and invoke muse-implement or muse-review.
```

For Hermes or OpenCode, add `--host hermes` or `--host opencode` to the collaborator command. Their supported integration is MCP tools and skills; their native model-provider integrations are not implemented. See the [host guides](../README.md#install) and [skill catalog](skills.md).

Installing collaborator mode does not disable native mode if you enabled it previously. Run the restore command above first if you want to return to Astra.

## Subscription or API

Account mode uses the official Muse CLI's saved credentials. Sign in and confirm that Muse is using the credential connected during subscription onboarding. Stored API keys can take precedence over browser login, so successful setup alone cannot verify subscription billing. The bridge never extracts or shares subscription tokens. Each user needs their own eligible Muse access.

For explicit pay-as-you-go API access, save your own additional Meta Model API key in a private file outside the repository, set its permissions to `600`, and use:

```sh
curl -fsSL https://raw.githubusercontent.com/danny-hines/muse-code-bridge/main/bootstrap.sh | bash -s -- \
  --native --auth api-key --api-key-file "$HOME/.config/muse-code-bridge/meta-api-key"
```

This example assumes the key file already exists. Omit `--native` for collaborator mode. API mode skips account login; only the key-file path is saved. Both modes use the official Muse CLI today. See [authentication details](../README.md#login-and-subscription) and the [API/subscription/OpenCode comparison](access-options.md).

## Updates

Wait until active work finishes, then rerun the bootstrap. Use `--native` to update and enable native mode; omit it for collaborator mode. Omit `--auth` and use `--no-login` to keep your saved credential choice without signing in again. Restart the desktop app afterward. Native reruns preserve the installed models, port, and original recovery copy. The installer refuses to replace locally modified source or conflicting managed settings.

This is an independent community project, not an official Meta or OpenAI desktop integration.
