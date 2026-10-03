/**
 * Tools always kept when a skill sets `allowedTools` (route prepareCall).
 * The Agent manager only reads agents (ADR 0002 / 03).
 */
export const ALWAYS_AVAILABLE_CHAT_TOOLS = ["readAgents"] as const;
