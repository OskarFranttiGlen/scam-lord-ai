/**
 * @module landlord-home/changed-step
 * Which floor node to flash after a calls refetch.
 * Depends on: none.
 * Used by: use-calls.
 */

/**
 * The first agent whose current step changed.
 * A new call (no previous row) does not flash. Empty previous list does not flash.
 */
export function changedStep(
    prev: readonly { id: string; currentStep: string }[],
    next: readonly { id: string; currentStep: string }[],
): { id: string; step: string } | null {
    const before = new Map(prev.map((agent) => [agent.id, agent.currentStep]));
    for (const agent of next) {
        const was = before.get(agent.id);
        if (was !== undefined && was !== agent.currentStep) {
            return { id: agent.id, step: agent.currentStep };
        }
    }
    return null;
}
