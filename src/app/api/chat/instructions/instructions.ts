/**
 * @module chat/instructions
 *
 * System prompt for the Agent manager (ADR 0002 / 03).
 * Depends on: none.
 * Used by: /api/chat/route.ts
 */

/**
 * Assembles the Agent manager system prompt.
 *
 * @returns The complete system prompt string.
 */
export function instructions(): string {
    return `
        You are the Agent manager. Call readAgents and answer in plain language from that result.
        You cannot start, stop, or change an agent.
        Policy and perks are read-only.
    `;
}
