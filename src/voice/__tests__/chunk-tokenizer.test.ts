import { describe, expect, it } from "vitest";

import { ChunkSentenceTokenizer } from "../chunk-tokenizer";

describe("ChunkSentenceTokenizer", () => {
    it("emits a short pushed sentence right away instead of waiting for the next one", async () => {
        const stream = new ChunkSentenceTokenizer().stream();

        stream.pushText("Let me check that. ");
        const first = await Promise.race([
            stream.next(),
            new Promise<"waiting">(resolve => setTimeout(() => resolve("waiting"), 50)),
        ]);

        expect(first).toEqual({ done: false, value: expect.objectContaining({ token: "Let me check that." }) });
        stream.close();
    });

    it("keeps each pushed chunk as its own token", async () => {
        const stream = new ChunkSentenceTokenizer().stream();

        stream.pushText("You can pay nine hundred twenty dollars today. ");
        stream.pushText("Does that work?");
        stream.endInput();
        const tokens: string[] = [];
        for await (const data of stream) {
            tokens.push(data.token);
        }

        expect(tokens).toEqual(["You can pay nine hundred twenty dollars today.", "Does that work?"]);
    });

    it("keeps the closing punctuation with its sentence when the markdown filter splits it off", async () => {
        const stream = new ChunkSentenceTokenizer().stream();

        stream.pushText(" Can you take care of it today");
        stream.pushText("?");
        stream.endInput();
        const tokens: string[] = [];
        for await (const data of stream) {
            tokens.push(data.token);
        }

        expect(tokens).toEqual(["Can you take care of it today?"]);
    });
});
