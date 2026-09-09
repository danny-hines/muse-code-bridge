# Muse Code Bridge for OpenCode

This integration adds Muse as an MCP collaborator to OpenCode. It does not add a model provider or install OpenCode itself.

If you only want Muse Spark as OpenCode's main model, Zen already offers a free Contributor option as of September 8, 2026. This bridge instead calls the Muse Code agent using your account/subscription or an explicit API key. See the [comparison](../../docs/access-options.md) and [authentication setup](../../README.md#login-and-subscription). API mode adds `--auth api-key --api-key-file /absolute/private/file` to the install command.

```sh
./install.sh --host opencode
```

The installer detects the installed CLI's major version, or an unambiguous existing MCP layout. If using only the desktop app with no MCP configuration yet, select the version explicitly:

```sh
./install.sh --host opencode --opencode-version 1
# OpenCode 2 beta:
./install.sh --host opencode --opencode-version 2
```

Restart OpenCode and ask in a new conversation:

> Use Muse to critique this implementation, then verify its findings.

Version 1 uses `mcp.muse_code_bridge` with `enabled: true`. Version 2 uses `mcp.servers.muse_code_bridge` with `disabled: false` and `codemode: false` so the tools appear directly. The installer rejects mismatched layouts instead of migrating unrelated settings.

It updates the existing global `opencode.json` or `opencode.jsonc` under `$XDG_CONFIG_HOME/opencode` (normally `~/.config/opencode`), respecting `OPENCODE_CONFIG`. Set `MUSE_BRIDGE_OPENCODE_CONFIG` for an explicit destination. If both global files exist, select the intended file explicitly. Project/managed configuration can override the global entry; this installer does not change those overrides.

Existing JSONC comments, trailing commas, providers, permissions, and other MCP entries are preserved. A changed file gets a private backup. Repeating the installation is a no-op; conflicting entries are not overwritten. `--check` makes no changes. Commands use absolute Node/server/Muse paths.

To remove it, delete only `muse_code_bridge` from the appropriate MCP map and restart OpenCode. To update, rerun the bootstrap or pull the clone and repeat the install command.

References: [OpenCode 1 MCP](https://opencode.ai/docs/mcp-servers/), [OpenCode 2 MCP](https://opencode.ai/v2/docs/mcp-servers), [configuration](https://opencode.ai/docs/config/), [custom providers](https://opencode.ai/docs/providers/#custom-provider).
