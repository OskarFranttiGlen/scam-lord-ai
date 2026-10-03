import type { ModelMessage } from "ai";

import { createCollectionVoiceAgent } from "@/voice/agent";
import { createInitialCallState } from "@/voice/context";
import { getDemoCallContext } from "@/voice/demo-context";
import { streamVoiceTurn } from "@/voice/run-turn";

const LINES = [
    "Okay. What are my options? What can we do about that?",
    "Can I pay half now and half next Friday?",
];

async function main(): Promise<void> {
    const context = getDemoCallContext();
    const state = createInitialCallState();
    const agent = createCollectionVoiceAgent({ context, state });
    let messages: ModelMessage[] = [
        { role: "assistant", content: `Hi, I'm an AI assistant calling for ${context.propertyName}. You have an open balance. Is now a good time?` },
    ];
    for (const line of LINES) {
        const t0 = performance.now();
        const turn = streamVoiceTurn({ agent, userText: line, messages, state });
        const chunks: string[] = [];
        let firstMs = 0;
        for await (const chunk of turn.textStream) {
            firstMs ||= performance.now() - t0;
            chunks.push(`[${Math.round(performance.now() - t0)}] ${chunk.trim()}`);
        }
        const result = await turn.result;
        messages = result.messages;
        console.log(JSON.stringify({ line, firstSpeechMs: Math.round(firstMs), doneMs: Math.round(performance.now() - t0), chunks }));
    }
}

main().catch((error: unknown) => {
    console.error(error);
    process.exit(1);
});
