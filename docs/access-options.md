# Muse Code subscription, API access, and OpenCode Zen

Bridge status and OpenCode Zen's published offering reviewed **September 13, 2026**. Prices, availability and provider terms can change; use the linked provider pages when choosing access. **The bridge integrations for Hermes and OpenCode are works in progress and currently untested in those hosts.**

## Choose by the experience you want

| Route | Agent doing the work | Access and billing | This bridge needed? |
|---|---|---|---|
| Codex MCP collaborator | Muse Code works alongside the selected Codex model | Bridge's configured Muse account or explicit API key | Yes |
| ChatGPT + Muse picker | Codex executes tools requested by the selected model | Native OpenAI auth or bridge Muse auth, selected by model ID | Yes; experimental companion app |
| OpenCode Zen | OpenCode uses its selected Zen model | Zen's own access, billing and data-use terms | No |
| Native model API provider | The host's own agent | Its configured API provider and key | No; separate provider configuration |

The [companion shortcut](shared-gateway-design.md) supports Muse text/tool handoffs alongside OpenAI in the desktop picker. OpenAI inference also passes through the local gateway in that launch. The original ChatGPT icon remains available; mobile behavior and broader compatibility still need verification.

Hermes/OpenCode MCP setup is intended to add Muse Code as another agent, with its own sessions and approvals. Native primary-model adapters for those hosts are not implemented here. Shared model names do not imply identical agent behavior or billing.

## OpenCode's separate free offering

As of the review date, Zen lists **Muse Spark 1.3 Contributor Free**, model ID `opencode/muse-spark-1.3-contributor-free`, with free input, output and cached reads. OpenCode describes the offer as limited-time. Its privacy page says the Contributor offering permits prompts and completions to be used to train future Meta models. Check availability and terms before selecting it. [Zen models and pricing](https://opencode.ai/docs/zen/), [Zen privacy](https://opencode.ai/docs/zen/#privacy).

Zen access does not use this bridge, the local Muse CLI or a Muse Code subscription. This project has not tested that OpenCode user flow. Its presence in Zen's published catalog is separate from the bridge's untested OpenCode integration.

## Explicit Meta API access

The bridge's API mode uses your additional Meta API key with the official Muse CLI. It does not choose Contributor, use OpenCode Zen, or switch billing routes after a failure. Choose an available model from `muse_status`; the configured account determines access.

For current standard/Contributor prices, cached-token rates and other charges, consult [Meta pricing and rate limits](https://dev.meta.ai/docs/pricing-rate-limits/). Review the data-use terms for the selected model and tier alongside its price.

API key handling is tested using synthetic credentials and processes. A paid Meta API request has not been used to validate this integration's API mode.

## Muse-managed account access

Account mode removes an inherited `META_API_KEY` and preserves Muse's stored credentials. The official CLI owns login and entitlement. If you intend to use a Muse Code subscription, confirm the active account, credential and plan in Muse; bridge discovery alone cannot prove which plan will be charged. See [Muse authentication](https://dev.meta.ai/docs/muse-code/auth) and [subscriptions](https://dev.meta.ai/docs/muse-code/subscriptions) for the current provider rules.

MCP consultations use `muse serve`; the primary-model adapter uses `muse exec`. Neither path extracts subscription tokens for use as general-purpose API keys. Use `muse_status` to inspect the selected bridge mode and discover models, then Muse's own account/usage interface for billing confirmation.

Each person installs the CLI and authenticates their own account. Sharing this repository shares no subscription or credentials. [Authentication setup](../README.md#login-and-subscription).

## Project scope

The Muse protocol/session code is shared across the installers. Codex has the locally tested MCP plugin and experimental macOS companion; Hermes and OpenCode have work-in-progress MCP configuration and skills that are currently untested in the actual hosts. No standalone chat UI, native Hermes/OpenCode model adapter, or comparative agent-quality benchmark is included.
