# Muse Code subscription, API access, and OpenCode's free model

Checked **September 8, 2026**. Availability, models, and prices can change.

## Choose by the experience you want

| Route | Agent doing the work | Access and billing | This bridge needed? |
|---|---|---|---|
| OpenCode Zen: Muse Spark Contributor Free | OpenCode, using Muse Spark as its model | Zen's current free offer; does not use your Muse Code subscription | No |
| Bridge: Muse-managed account | Muse Code, called by Codex, Hermes, or OpenCode | Muse's stored credentials; subscription applies when its onboarding credential and plan are active | Yes |
| Bridge: explicit API key | Muse Code, called by the host | Your additional Meta API key, billed per token | Yes |
| Native model API provider | The host's own agent | Its configured API provider and key | No; separate provider configuration |

For **Codex plus your Muse Code subscription**, the MCP bridge lets Codex collect browser evidence, ask Muse for another approach, then test the result and continue the same Muse conversation. The host keeps its selected model. The separate [experimental combined picker on macOS](setup.md#select-muse-directly-in-codex--chatgpt-desktop-macos-experimental) lets you select Muse as the primary model alongside OpenAI options, with text/tool handoffs and current compatibility limits.

For **Muse Spark as OpenCode's main model**, try the existing Zen route first. The bridge adds the Muse Code agent alongside OpenCode, with Muse's own sessions, tools, and approvals. These are different agent setups; a shared model family does not imply identical behavior. Native adapters for OpenCode and Hermes are not implemented. See [OpenCode custom providers](https://opencode.ai/docs/providers/#custom-provider) and [Hermes provider configuration](https://hermes-agent.nousresearch.com/docs/user-guide/configuration/) for their separate interfaces.

## What is free in OpenCode today?

Zen lists **Muse Spark 1.3 Contributor Free**, with free input, output, and cached reads. Its OpenCode model identifier is `opencode/muse-spark-1.3-contributor-free`. OpenCode describes this as a limited-time offer; no permanent free entitlement is implied. Follow Zen's connection instructions and choose that exact model from the model list. [OpenCode Zen](https://opencode.ai/docs/zen/).

This is Zen-provided model access, not a connection to your Muse Code subscription or a local Muse Code process. OpenCode's privacy section says this Contributor offering permits prompts and completions to be used for training future Meta models. The free offer should therefore not be treated as interchangeable with standard non-training API access. [Zen privacy information](https://opencode.ai/docs/zen/#privacy).

## Meta API prices

USD per **one million tokens**, for the documented Spark 1.3 tiers:

| Tier | Input | Output | Cached input | Prompts/completions used for Meta training? |
|---|---:|---:|---:|---|
| Standard | $1.25 | $4.25 | $0.15 | No, according to the tier description |
| Contributor | $0.10 | $0.20 | $0.002 | Permission granted for training |

These are **Meta's direct API prices**, separate from Zen's free promotion. Contributor is inexpensive, but its data-use choice is part of the tier. Other charges can apply, such as web-search grounding. A coding conversation may make several model calls and resend context, so per-token prices are not per-task prices. [Meta pricing and rate limits](https://dev.meta.ai/docs/pricing-rate-limits/).

The bridge's API mode uses your additional Meta API key with the official CLI. It does not automatically select Contributor or send traffic to OpenCode Zen. Choose a model from `muse_status`; the bridge does not substitute a cheaper model, switch providers, or retry with a different billing route.

## How the subscription differs

Meta ties Muse Code subscriptions to the credential connected automatically during CLI onboarding. It is for Muse Code only; separately created Model API keys use pay-as-you-go. Subscription use runs through the CLI while signed in to the associated account. When usage limits are reached, Meta documents waiting for reset or upgrading. [Muse Code subscriptions](https://dev.meta.ai/docs/muse-code/subscriptions).

That is why this project uses the official CLI: `muse serve` for MCP conversations and `muse exec` for the experimental picker adapter. It does not turn subscription credentials into general-purpose API credentials. Account mode removes an inherited `META_API_KEY`, but preserves Muse's stored credentials; Muse decides the actual entitlement. The documented credential precedence is environment key, stored key, then stored browser session. [Muse authentication](https://dev.meta.ai/docs/muse-code/auth).

Use `muse_status` to check the bridge's selected authentication mode and discover models. It does not prove which plan was charged. Confirm that in Muse's own account and usage interface. Each person installs their own CLI and authenticates their own account; sharing this repository shares no subscription or credentials.

## Project scope

One repository keeps the Muse session implementation shared and the host installers separate. Codex gets the `muse-codex-bridge` plugin and a collaboration skill; Hermes and OpenCode get MCP configuration. Both account and API modes keep this same workflow. Setup instructions are in the [README](../README.md#login-and-subscription).

The standard installation calls **Muse Code from an existing host conversation** through MCP. The experimental macOS launcher adds a primary-model adapter and Codex tool handoffs; its broader desktop-tool compatibility is still under test. There is no standalone chat UI or native Hermes/OpenCode adapter. No comparative quality benchmark between the agents has been performed.
