/**
 * @module chat/tools
 *
 * Vercel AI SDK tools for the chat ToolLoopAgent (ADR 0034 / C2 keep-set).
 * Artifact CRUD + skill sandbox + Questionnaire gate.
 *
 * Depends on: ai, zod, mutations/agentSchema, questionnaire-gate/select,
 *   ./read-artifact, ./mutate-artifact-execute
 * Used by: /api/chat/route.ts
 */

import { z } from "zod";
import { tool } from "ai";

import {
    buildMutateArtifactToolDescription,
    mutateArtifactInputSchema,
} from "@/components/artifact-builder/mutations/agentSchema";
import type { TArtifactOperation } from "@/components/artifact-builder/mutations/schemas";
import { selectQuestionnaireGateQuestions } from "@/app/api/chat/questionnaire-gate/select";
import {
    artifactSnapshotHasContent,
    formatReadArtifactForModel,
    readArtifactInputSchema,
    readArtifactSnapshot,
} from "./read-artifact";
import { runMutateArtifactTool } from "./mutate-artifact-execute";

function stripFrontmatter(content: string): string {
    const match = content.match(/^---\r?\n[\s\S]*?\r?\n---\r?\n?/);
    return match ? content.slice(match[0].length).trim() : content.trim();
}

export type TGetToolsProps = {
    /** Request-start Chat artifact JSON (not re-fetched mid-turn). */
    artifactDocument?: TChatArtifactDocument;
};

/**
 * Factory that creates the C2 keep-set tool registry for the chat agent.
 *
 * @param props.artifactDocument - Snapshot from the chat request body
 * @returns An object mapping tool names to Vercel AI SDK tool descriptors.
 * Skill tools keep `contextSchema` so `ToolLoopAgent.toolsContext` type-checks.
 */
export function getTools({ artifactDocument }: TGetToolsProps = {}) {
    const sandboxContextSchema = z.object({
        sandbox: z.custom<ISandbox>(),
    });

    const loadSkillContextSchema = z.object({
        sandbox: z.custom<ISandbox>(),
        skills: z.array(
            z.object({
                name: z.string(),
                description: z.string(),
                path: z.string(),
                allowedTools: z.array(z.string()).optional(),
            }),
        ),
        activeToolScope: z.object({
            allowedTools: z.array(z.string()).nullable(),
        }),
    });

    /** Same-turn read gate for live-grid mutateArtifact. */
    let readArtifactCalledThisTurn = false;

    const loadSkillTool = tool({
        description: "Load a skill to get specialized instructions",
        inputSchema: z.object({
            name: z.string().describe("The skill name to load"),
        }),
        contextSchema: loadSkillContextSchema,
        execute: async ({ name }, { context }) => {
            const { sandbox, skills, activeToolScope } = context;

            const skill = skills.find(s => s.name.toLowerCase() === name.toLowerCase());
            if (!skill) {
                return { error: `Skill '${name}' not found` };
            }

            if (skill.allowedTools?.length) {
                activeToolScope.allowedTools = skill.allowedTools;
            }

            const skillFile = `${skill.path}/SKILL.md`;
            const content = await sandbox.readFile(skillFile, "utf-8");
            const body = stripFrontmatter(content);

            return {
                skillDirectory: skill.path,
                content: body,
            };
        },
    });

    /**
     * Title: readFileTool
     * Description: Tool to read a file from the filesystem
     * @returns { Tool }
     */
    const readFileTool = tool({
        description: "Read a file from the filesystem",
        inputSchema: z.object({ path: z.string() }),
        contextSchema: sandboxContextSchema,
        execute: async ({ path }, { context }) => {
            return context.sandbox.readFile(path, "utf-8");
        },
    });

    /**
     * Title: bashTool
     * Description: Tool to execute a bash command
     * @returns { Tool }
     */
    const bashTool = tool({
        description: "Execute a bash command",
        inputSchema: z.object({ command: z.string() }),
        contextSchema: sandboxContextSchema,
        execute: async ({ command }, { context }) => {
            return context.sandbox.exec(command);
        },
    });

    const getMoreInfoQuestionsTool = tool({
        description:
            "Opens the Questionnaire gate with the app-chosen question subset. " +
            "Optional — call when gathering preferences would help. " +
            "Do not invent extra questions — the tool picks the list. " +
            "Never treat the gate as required before artifact work. " +
            "If it returns no questions, the gate is not needed; continue helping in chat.",
        inputSchema: z.object({
            userRequest: z.string().optional().describe("The user's original request for context"),
        }),
        execute: async ({ userRequest }) => {
            try {
                const selected = selectQuestionnaireGateQuestions({
                    userRequest: userRequest || "",
                });
                return {
                    ...selected,
                    userRequest: userRequest || "",
                    message:
                        selected.reason === "none"
                            ? "Questionnaire gate not needed."
                            : "Questions component opened to gather preferences.",
                };
            } catch (error) {
                console.error("Error in getMoreInfoQuestions tool:", error);
                return {
                    error: "Failed to load questions",
                    message: error instanceof Error ? error.message : "Unknown error",
                };
            }
        },

        toModelOutput: async ({ output }) => {
            if ("error" in output && output.error) {
                return {
                    type: "text" as const,
                    value: `Error: ${output.message || "Failed to load questions"}`,
                };
            }
            if (!("reason" in output)) {
                return {
                    type: "text" as const,
                    value: output.message || "Questionnaire gate not needed. Continue helping in chat.",
                };
            }
            if (output.reason === "none") {
                return {
                    type: "text" as const,
                    value: "Questionnaire gate not needed. Continue helping in chat.",
                };
            }
            return {
                type: "text" as const,
                value:
                    "Questions are open. Wait for the user to submit or skip, then continue helping in chat.",
            };
        },
    });

    const readArtifactTool = tool({
        description:
            "Returns the Chat artifact snapshot from the start of this request " +
            "(week/day/item JSON). Required before mutateArtifact when the artifact " +
            "already has weeks — use weekIndex, dayId, and itemId from this snapshot, " +
            "not from an earlier turn.",
        inputSchema: readArtifactInputSchema,
        execute: async () => {
            readArtifactCalledThisTurn = true;
            const snapshot = readArtifactSnapshot(artifactDocument);
            return { artifactDocument: snapshot };
        },
        toModelOutput: async ({ output }) => {
            const snapshot = readArtifactSnapshot(
                (output as { artifactDocument?: TChatArtifactDocument }).artifactDocument,
            );
            return {
                type: "text" as const,
                value: formatReadArtifactForModel(snapshot),
            };
        },
    });

    const mutateArtifactTool = tool({
        description: buildMutateArtifactToolDescription(),
        inputSchema: mutateArtifactInputSchema,
        execute: async ({ operations }) => {
            return runMutateArtifactTool(
                artifactDocument,
                operations as TArtifactOperation[],
                readArtifactCalledThisTurn,
            );
        },
        toModelOutput: async ({ output }) => {
            if (output && typeof output === "object" && "error" in output && output.error) {
                const o = output as {
                    error: string;
                    message?: string;
                    failures?: Array<{ index: number; op: string; reason: string }>;
                };
                if (typeof o.message === "string" && o.message.length > 0) {
                    return {
                        type: "text" as const,
                        value: o.message,
                    };
                }
                const failureLines =
                    o.failures?.map((f) => `[${f.index}] ${f.op}: ${f.reason}`).join("; ") ??
                    "Unknown validation error";
                return {
                    type: "text" as const,
                    value: `Mutation batch rejected: ${failureLines}`,
                };
            }

            const o = output as { operations?: unknown[] };
            const count = o.operations?.length ?? 0;
            const empty = !artifactSnapshotHasContent(artifactDocument);
            if (empty) {
                return {
                    type: "text" as const,
                    value:
                        `Artifact mutate ready (${count} operation${count === 1 ? "" : "s"}). ` +
                        "The empty artifact will land these changes on the grid when the turn finishes. " +
                        "In your visible reply, summarize what you built. " +
                        "Do not ask the user to Accept.",
                };
            }
            return {
                type: "text" as const,
                value:
                    `Mutation proposal ready (${count} operation${count === 1 ? "" : "s"}). ` +
                    "The grid is unchanged until the user Accepts. " +
                    "In your visible reply, describe what you want to change. " +
                    "Do not say the artifact was updated, modified, applied, or is now different. " +
                    "Do not write \"I've updated\" or \"Your artifact is now\".",
            };
        },
    });

    return {
        readArtifact: readArtifactTool,
        mutateArtifact: mutateArtifactTool,
        getMoreInfoQuestions: getMoreInfoQuestionsTool,
        loadSkill: loadSkillTool,
        readFile: readFileTool,
        bash: bashTool,
    };
}

/** Inferred from `getTools` so skill-tool context stays exact (no `Tool<unknown, …>` variance). */
export type TChatTools = ReturnType<typeof getTools>;
