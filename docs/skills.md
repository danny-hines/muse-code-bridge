# Collaboration skills

Skills guide the responsibility split using the host's selected model and the shared Muse MCP connection. They do not change the model picker, reasoning settings, authentication mode, or enforce a token budget.

| Skill | Muse does | Host does | Example |
|---|---|---|---|
| `muse-implement` | Implementation, appropriate tests, routine corrections | Scope, consequential design decisions, final verification | “Use muse-implement to add this feature. Prioritize conserving host usage.” |
| `muse-review` | Read-only critique of an implementation | Verify findings and make fixes when authorized | “Use muse-review on the current diff and reproduce material findings.” |
| `muse` | Consultation and alternative approaches | Evaluate proposals and supply relevant evidence | “Ask Muse for another approach to this design.” |

`muse` contains the shared protocol read by the other skills and is automatically included with either workflow. Investigation and comparison skills are possible future additions, not part of this collection yet.

## Install and choose

Codex gets the complete collection inside the existing plugin:

```sh
./install.sh --host codex
```

Hermes and OpenCode can install the whole collection or select workflows:

```sh
./install.sh --list-skills
./install.sh --host hermes --skills implement
./install.sh --host opencode --skills implement,review
./install.sh --host hermes --host opencode --skills all
```

The same flags work with the curl bootstrap:

```sh
curl -fsSL https://raw.githubusercontent.com/danny-hines/muse-code-bridge/main/bootstrap.sh | bash -s -- --host hermes --skills implement
```

Omitting `--skills` preserves each Hermes/OpenCode installation's previous selection; a fresh installation defaults to `all`. `core` installs just `muse`. `none` removes installer-managed, unmodified skills while keeping MCP configured. Codex always bundles all skills and rejects partial selections; choose the workflow in the conversation.

`--check` checks the selected destinations and conflicts without installing anything. `--list-skills` lists the catalog without contacting Muse; the bootstrap's catalog listing requires no downloads.

## Discovery in each host

| Host | Installed location | Invocation |
|---|---|---|
| Codex | The plugin's `skills/` directory in the Codex plugin cache | Enable Muse Code Bridge; mention `muse-implement` in the skill picker or ask to use it by name. |
| OpenCode 1 and 2 | `~/.config/opencode/skills/`, respecting `XDG_CONFIG_HOME` | Ask to use `muse-implement`; the agent loads it with its native skill tool. Skill permissions can affect discovery. |
| Hermes | The active `HERMES_HOME/skills/`, normally `~/.hermes/skills/` | `/muse-implement <task>`, or ask to use the skill in natural language. |

Restart the selected host after current work finishes. For Codex on macOS, fully quit with Cmd+Q, reopen, and start a new local task in the intended project. Existing processes may retain old plugin code. The host should discover both the chosen skill and the Muse MCP tools. Cloning this repository alone does not install skills globally.

Use `MUSE_BRIDGE_HERMES_SKILLS_DIR` or `MUSE_BRIDGE_OPENCODE_SKILLS_DIR` for an explicit destination. A custom MCP config-file override does not relocate skills; set the skill override too when needed. Select the same Hermes profile for the MCP config and skills. These installers configure the hosts; they do not install the host apps.

Source documentation checked September 11, 2026: [Codex skills and plugins](https://learn.chatgpt.com/docs/customization/overview), [OpenCode 1 skills](https://opencode.ai/docs/skills/), [OpenCode 2 skills](https://opencode.ai/v2/docs/skills), [Hermes skills](https://hermes-agent.nousresearch.com/docs/user-guide/features/skills).

## Updates and removal

Rerun the bootstrap or pull the repository and rerun the installer. Hermes/OpenCode updates use `.muse-code-bridge-skills.json` in the destination to track the selection and file hashes. Locally modified skills, extra files, links, and unrelated existing folders are preserved; a conflict stops the skill update before replacing any skill. Reconcile or move a conflicting skill aside and rerun. Do not delete the manifest to force an overwrite.

To remove managed skills:

```sh
./install.sh --host hermes --skills none
./install.sh --host opencode --skills none
```

Then remove the MCP entry as described in that host's guide if the bridge is no longer wanted. Removing the Codex plugin removes its bundled skills with it. Each recipient uses their own Muse credentials; the collection contains no account information.

## Testing your responsibility split

Start with a bounded task and clear acceptance criteria. The host should hand a coherent milestone to Muse in `code` mode, wait for completion, inspect the actual diff, and verify critical behavior. Muse review mode disables shell and writes; the host supplies test or browser evidence as needed. Muse cannot automatically use the host's browser or other plugins.

Each Muse turn is limited to ten minutes. A limit or uncertain failure must be reported with the session ID and partial work; do not repeat a submission automatically. The current polling interface returns accumulated turn content. The skills discourage duplicate investigation and unnecessary narration, but compact transport-level polling is not implemented.

Measure usage per accepted result, elapsed time, and rework across representative tasks. A syntax validator does not establish model behavior or allowance savings. Automated checks cover installation, update preservation, and bridge wiring; actual host behavior should be evaluated in a real task.

## Maintaining the collection

Author canonical files under `skills/`. `npm run build` copies them to `dist/skills/` for Hermes/OpenCode and to the Codex plugin. Do not edit generated copies. The `muse` companion stays installed with either specialized skill so its relative protocol reference resolves in every host. Keep workflow names and descriptions distinct and preserve normal automatic discovery; a skill applies when it matches the user's task.
