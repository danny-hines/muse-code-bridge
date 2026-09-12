# Additive model selection: requirements and status

**Status: not implemented.** The supported desktop integration is Muse through [MCP tools and skills](setup.md). The previous global provider activation has been withdrawn because it replaced existing model options. The retained [protocol prototype](native-provider.md) validates some text/tool handoffs, not a combined desktop picker.

## Required behavior

One model picker must contain the existing OpenAI models and the models available through the user's configured Muse authentication. Installing the bridge must preserve the OpenAI account, default model, normal catalog refresh, and existing tasks. No global provider replacement or hardcoded list of OpenAI models is acceptable.

Selecting an OpenAI model must use the normal OpenAI account path. Selecting a Muse model must use the explicitly configured Muse account or API-key path. This must hold when creating, resuming, and forking tasks, and when switching models during a task. A model name in a menu is not evidence of correct routing. Provider errors must not silently trigger a different provider or authentication mode.

## Automatic discovery

- Read OpenAI's current account catalog through the host's model discovery interface; preserve its model metadata and visibility rules.
- Read Muse's available models through the official CLI's `model/list` using the user's selected authentication mode. Preserve supported capabilities and defaults without overriding the user's OpenAI default.
- Refresh at startup and automatically during use. Target a refresh interval of at most five minutes while the app is running, plus refresh on reconnect. No repository update, config edit, or manual model registration may be required for a newly available compatible model.
- Update the visible picker and the routing layer together. A new name in a static catalog is insufficient if the backend still rejects that model.
- Preserve a user's existing selection while it remains available. If a model disappears or access is lost, report it clearly and request a new selection; do not substitute another model silently.
- A Muse discovery outage must leave OpenAI available. A last-known catalog may be used during transient discovery failures, with stale state identified. Unavailable credentials and denied access must be surfaced rather than hidden by cached entries.

“Automatically available” means the provider exposes the model to that user's account and the adapter supports its protocol and required inputs. A public announcement does not grant account access. A new model requiring a new wire format or modality may need an adapter update; show that limitation explicitly. The integration must not promise compatibility it has not established.

## Current integration findings

The documented Codex configuration selects one `model_provider` and optionally loads `model_catalog_json` at startup. That is not a documented per-model routing mechanism. The current app-server schema accepts a provider on task start/resume, while a turn's model override does not include a provider field. Both catalog merging and provider routing need a desktop-level integration.

The installed desktop build includes an internal custom-CLI hook. A local app-server adapter may be a path to combining discovery and dispatch, but this has not been implemented or verified. That internal hook is not a documented stable plugin API. Do not install a wrapper into the user's normal app runtime until lifecycle, routing, and GUI behavior are verified in isolation.

The existing native server accepts a fixed installed Muse model list, so it also needs live discovery before satisfying these requirements. Re-running its installer is not an automatic-update solution.

## Acceptance before release

1. In the actual desktop picker, show the user's normal OpenAI catalog plus Muse, preserving the original default and authentication.
2. Complete a text reply and a host tool round trip on each provider. Verify which provider handled each request without logging credentials or private prompts.
3. Verify resumed tasks, forks, model switches in both directions, cancellation, and app restarts. Provider selection must persist correctly.
4. Simulate newly available model IDs from both catalogs, without changing source or installed configuration. Confirm they appear and route correctly within the refresh interval. Test removals, changed defaults, pagination, and name collisions too.
5. Test Muse outages, stale catalogs, expired authentication, and incompatible model capabilities while confirming OpenAI remains usable.
6. Confirm upgrades and uninstall preserve user settings and restore the standard runtime. Only then offer a one-command native installation.

References: [Codex custom providers](https://learn.chatgpt.com/docs/config-file/config-advanced#custom-model-providers), [configuration reference](https://learn.chatgpt.com/docs/config-file/config-reference), [app-server protocol](https://learn.chatgpt.com/docs/app-server).
