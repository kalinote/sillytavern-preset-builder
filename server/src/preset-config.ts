export const PRESET_PROMPT_FIELD_KEYS = [
  "impersonation_prompt",
  "new_chat_prompt",
  "new_group_chat_prompt",
  "new_example_chat_prompt",
  "continue_nudge_prompt",
  "group_nudge_prompt",
  "send_if_empty",
  "wi_format",
  "scenario_format",
  "personality_format",
  "assistant_prefill",
  "assistant_impersonation",
  "continue_postfix",
] as const;

export const PRESET_PROMPT_FIELD_SET = new Set<string>(PRESET_PROMPT_FIELD_KEYS);
