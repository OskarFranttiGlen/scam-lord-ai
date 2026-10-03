/**
 * @module chat
 *
 * Streaming chat API for the RentRecovery agent manager.
 * Runs a Vercel AI SDK ToolLoopAgent and streams UI updates.
 *
 * Depends on: ai (Vercel AI SDK), @langfuse/tracing, ./instructions, ./tools
 * Used by: dashboard chat panel
 */

import { ToolLoopAgent, createAgentUIStreamResponse, gateway, isStepCount } from 'ai';
import { after } from 'next/server';
import { observe, propagateAttributes } from '@langfuse/tracing';
import { langfuseSpanProcessor } from '../../../../instrumentation';
import { createClient } from '@/utils/supabase/server';
import { instructions } from './instructions/instructions';
import { getTools } from './tools/tools';
import { createSandbox } from './skills/sandbox';
import { discoverSkills } from './skills/index';
import z from 'zod';
import { sanitizeMessagesWithUnresolvedToolCalls } from './sanitize-messages';
import { ALWAYS_AVAILABLE_CHAT_TOOLS } from './always-available-tools';
import { streamAgentOnError } from './stream-on-error';

export const maxDuration = 120;

function buildSkillsPrompt(skills: ISkillMetadata[]): string {
    if (skills.length === 0) return '';

    const skillsList = skills
        .map(s => `- ${s.name}: ${s.description}`)
        .join('\n');

    return `
        ## Skills

        Use the \`loadSkill\` tool when the user's request would benefit from specialized instructions. Choose the skill whose description best matches the request.

        Available skills:
        ${skillsList}
    `;
}

const callOptionsSchema = z.object({
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

async function handleChatPost(req: Request) {
    try {
        const {
            messages,
            chatSessionId,
            debugMode = false,
        } = await req.json();

        void debugMode;

        const supabase = await createClient();
        const { data: { user } } = await supabase.auth.getUser();

        const userId = user?.id?.slice(0, 200) || undefined;
        const sessionId = typeof chatSessionId === 'string' && chatSessionId.trim()
            ? chatSessionId.trim().slice(0, 200)
            : undefined;

        return propagateAttributes(
            { userId, sessionId, traceName: 'agent-chat', metadata: { source: 'dashboard' } },
            async () => {
                const sanitizedMessages = sanitizeMessagesWithUnresolvedToolCalls(messages);

                const systemPrompt = instructions();
                const tools = getTools();

                const sandbox = createSandbox({ workingDirectory: process.cwd() });
                const skills = await discoverSkills(sandbox, ['.agents/skills']);
                const activeToolScope: { allowedTools: string[] | null } = { allowedTools: null };

                const agent = new ToolLoopAgent({
                    model: gateway(
                        'google/gemini-3.1-flash-lite',
                    ),
                    instructions: systemPrompt,
                    tools: tools,
                    callOptionsSchema: callOptionsSchema,
                    stopWhen: isStepCount(28),
                    telemetry: { isEnabled: true },
                    prepareCall: ({ options, ...settings }) => {
                        let filteredTools = settings.tools;
                        if (options.activeToolScope.allowedTools?.length) {
                            const allowed = new Set([
                                ...options.activeToolScope.allowedTools,
                                ...ALWAYS_AVAILABLE_CHAT_TOOLS,
                            ]);
                            filteredTools = Object.fromEntries(
                                Object.entries(settings.tools as Record<string, unknown>).filter(
                                    ([name]) => allowed.has(name)
                                )
                            ) as typeof settings.tools;
                        }
                        return {
                            ...settings,
                            tools: filteredTools,
                            instructions: `${settings.instructions}\n\n${buildSkillsPrompt(options.skills)}`,
                        };
                    },

                    providerOptions: {
                        google: {
                            thinkingConfig: {
                                thinkingLevel: 'low',
                                includeThoughts: true,
                            },
                        },
                    },
                });

                after(async () => {
                    try {
                        await langfuseSpanProcessor.forceFlush();
                    } catch (err) {
                        console.error('[langfuse] forceFlush failed:', err);
                    }
                });

                return createAgentUIStreamResponse({
                    agent,
                    uiMessages: sanitizedMessages,
                    options: { sandbox, skills, activeToolScope },
                    onError: streamAgentOnError,
                });
            }
        );

    } catch (error) {
        console.error('Error in chat API route:', error);
        return new Response(JSON.stringify(
            { error: 'Failed to process chat request' }),
            {
                status: 500,
                headers: { 'Content-Type': 'application/json' },
            }
        );
    }
}

export const POST = observe(handleChatPost, {
    name: 'agent-chat',
    endOnExit: false,
});
