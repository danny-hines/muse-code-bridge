# Muse Code Bridge for Hermes

This integration adds Muse as an MCP collaborator to Hermes. It does not replace the selected Hermes model or install Hermes itself.

It also installs `muse-implement`, `muse-review`, and their shared `muse` protocol skill into the active profile's `skills/` directory. Select a workflow with `--skills implement` or `--skills review`; omitted selections persist on updates. Invoke `/muse-implement <task>` for delegated coding or `/muse-review <target>` for a critique. Use `--skills none` to remove only unmodified managed skills. See the [skill catalog](../../docs/skills.md) for custom directories, examples, and update behavior.

Use Muse-managed account credentials (the default), or add `--auth api-key --api-key-file /absolute/private/file` for explicit pay-as-you-go access. Both modes use the Muse Code agent. See [authentication setup](../../README.md#login-and-subscription) and the [access comparison](../../docs/access-options.md).

```sh
./install.sh --host hermes
```

Restart Hermes and open a new conversation in your project:

> Use Muse to review this project. Compare its recommendations with yours.

The installer adds `mcp_servers.muse_code_bridge` to `~/.hermes/config.yaml`, or the active `HERMES_HOME/config.yaml`. It writes absolute Node, server, and Muse paths so desktop launches do not depend on your shell PATH. Existing settings and comments are preserved; changing a file creates a private backup. Repeating the same installation is a no-op. A conflicting existing entry is left untouched.

For a custom/profile configuration file, set `MUSE_BRIDGE_HERMES_CONFIG` to its absolute path. `--check` validates the configuration without writing it. Install Hermes with MCP support using its official installer; this script configures the bridge only.

To remove the integration, delete just `mcp_servers.muse_code_bridge` from that file and restart Hermes. Leave other settings and servers intact. To update, rerun the bootstrap or pull your clone and repeat the command above.

Hermes supports [local MCP servers](https://hermes-agent.nousresearch.com/docs/user-guide/features/mcp). Its separate [external-process provider plugin interface](https://hermes-agent.nousresearch.com/docs/developer-guide/model-provider-plugin#external-process-acp-providers) is a possible future native-provider route. That adapter is not implemented.
