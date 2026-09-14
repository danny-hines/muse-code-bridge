# Combined model selection: requirements and status

Status reviewed September 13, 2026. The current experimental path is the [ChatGPT + Muse companion shortcut and shared gateway](shared-gateway-design.md). It uses one native task server, preserves the built-in OpenAI provider, and routes inference by model ID. Its native and live checks passed on `codex-cli 0.154.0-alpha.6.2`; actual desktop/phone Remote behavior and automatic visible picker refresh remain unverified.

The [older additive launcher](additive-development.md) uses a coordinator and per-task workers. Desktop model selection in that implementation was user-tested on September 12, but its Remote architecture was incompatible and is now disabled. Those results must not be presented as shared-gateway acceptance results. The [global provider-replacement prototype](native-provider.md) remains withdrawn.

## Required behavior

One picker should contain the existing OpenAI models and the compatible Muse models available through the user's configured authentication. Setup must preserve the OpenAI account, ordinary launch path and existing history. No global provider replacement or hardcoded OpenAI model list is acceptable.

Selecting OpenAI must use native authentication to its original inference endpoint; in the shared mode, those requests pass through the local gateway. Selecting Muse must use the configured Muse account or key. Provider errors must not silently trigger a different provider or authentication mode. A model name in a menu is not evidence of correct routing.

The integration should support task creation, resumption, forking and provider switches while retaining history. Each operation requires evidence in the current implementation. Desktop and Remote should use the same task server rather than competing for writer locks in separate workers.

## Automatic discovery

- Preserve OpenAI model metadata and visibility when proxying native `/models` discovery; append compatible `muse/<id>` entries without taking over a native identifier.
- Discover Muse models through the official CLI under the selected authentication mode. The shared gateway refreshes Muse at startup and every five minutes; OpenAI discovery remains native.
- Keep request validation consistent with discovery. Unavailable Muse models must fail explicitly without cross-provider fallback.
- Preserve selections while access remains available. Cached model names alone do not prove current access or compatibility.
- Verify visible picker refresh separately. The target is newly available compatible models appearing within five minutes and after reconnect, without manual registration. The desktop's caching/filtering means this bound has not been established.

A newly announced model is not necessarily available to the account or compatible with the adapter. New modalities, hosted tools or wire formats may require an adapter update. A Muse discovery failure should not break ordinary OpenAI requests; a gateway failure can affect both providers. Native WebSocket authentication is also a dependency of the shared connection.

## Evidence by implementation

| Implementation | Evidence | Unverified or unsupported |
|---|---|---|
| Shared gateway / companion app | Native fixture catalog, one task server, private desktop defaults, native shell-tool round trip, provider switches, stock-launch recovery; live OpenAI → Muse → OpenAI task using existing logins | Actual desktop/phone Remote use and mobile picker; automatic GUI refresh; broader task resume/fork, auth refresh, advanced tools and automation |
| Older additive workers | User-confirmed desktop selection; native fixture routing, history, fork, restart, cancellation and private settings tests | Remote is disabled; GUI refresh bound and broader feature coverage remain unverified |
| Standalone protocol prototype | Responses/tool translation and legacy configuration restoration tests | Provider-replacement activation is withdrawn; fixed catalog; no supported desktop activation |

The shared launcher uses the desktop's internal custom-CLI hook, scoped to that app process, and a native `openai_base_url` override. It does not install a documented stable model-picker plugin API. It checks the native version and keeps the original icon available when an app update is not yet supported.

## Acceptance before broader release

1. Verify the actual shared-launch desktop picker and phone Remote UI, including reopen/reconnect and model selection in each client.
2. Test resumed tasks, forks, cancellation and restarts on the shared gateway; distinguish fixture coverage from real UI acceptance.
3. Verify newly added/removed model IDs and account access changes at both the catalog and visible picker, including the refresh bound.
4. Exercise provider outages, expired credentials, native auth refresh and unsupported Muse capabilities without incorrect provider fallback.
5. Test advanced desktop tools and automation. Muse remains a text and tool-handoff adapter with buffered responses and limited context support.
6. Verify native app upgrades, companion reinstall/removal and standard-icon recovery. Remote-saved defaults use native persistence and may require an OpenAI selection in the stock app.

See [current gateway limits and verification commands](shared-gateway-design.md#limits-and-remote-verification) for the exact boundary of the tested behavior.

References: [OpenAI base URL configuration](https://learn.chatgpt.com/docs/config-file/config-advanced#custom-model-providers), [app-server protocol](https://learn.chatgpt.com/docs/app-server).
