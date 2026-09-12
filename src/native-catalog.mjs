export function makeCatalog(models) {
  return { models: models.map((model, priority) => ({
    slug: model, display_name: `${model.replace(/^muse-spark-/, 'Muse Spark ').replace(/-contributor$/, ' Contributor')} (experimental)`,
    description: 'Muse Code through your configured bridge authentication. Experimental text and Codex tool adapter.',
    default_reasoning_level: 'high',
    supported_reasoning_levels: ['low', 'medium', 'high', 'xhigh'].map(effort => ({ effort, description: `${effort} Muse reasoning` })),
    shell_type: 'unified_exec', visibility: 'list', supported_in_api: true, priority,
    base_instructions: 'You are Muse Code operating inside Codex. Use the tools provided by this host to complete the user request. Follow the supplied instructions, respect tool approvals, and verify work before reporting completion.',
    supports_reasoning_summaries: false, support_verbosity: false,
    apply_patch_tool_type: 'freeform',
    truncation_policy: { mode: 'bytes', limit: 10000 },
    // A conservative adapter operating limit, not a claim about Meta's model capacity.
    context_window: 64000, effective_context_window_percent: 90,
    input_modalities: ['text'], supports_search_tool: false, experimental_supported_tools: [],
    include_skills_usage_instructions: true, include_plugin_usage_instructions: true, include_apps_usage_instructions: true,
  })) };
}
