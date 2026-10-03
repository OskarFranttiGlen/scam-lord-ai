/**
 * @module voice/chunk-tokenizer
 *
 * TTS sentence tokenizer for the brain's streamed reply. The brain already sends whole
 * sentences, but LiveKit's basic tokenizer holds each sentence until the next one starts and
 * merges short ones ("Let me check that.") forward, which delays the first audio by a whole
 * sentence. This one sends every pushed chunk to TTS as soon as it arrives.
 *
 * Depends on: @livekit/agents
 * Used by: @/voice/worker.ts
 */

import { tokenize } from "@livekit/agents";

/**
 * Sentence stream that flushes after every pushed chunk.
 */
class ChunkSentenceStream extends tokenize.SentenceStream {
    readonly #inner: tokenize.SentenceStream;

    /**
     * @param inner - Basic sentence stream doing the splitting and token output
     */
    constructor(inner: tokenize.SentenceStream) {
        super();
        this.#inner = inner;
    }

    override pushText(text: string): void {
        this.#inner.pushText(text);
        this.#inner.flush();
    }

    override flush(): void {
        this.#inner.flush();
    }

    override endInput(): void {
        this.#inner.endInput();
    }

    override next(): Promise<IteratorResult<tokenize.TokenData>> {
        return this.#inner.next();
    }

    override close(): void {
        super.close();
        this.#inner.close();
    }
}

/**
 * Basic sentence tokenizer whose streams emit each pushed chunk immediately.
 */
export class ChunkSentenceTokenizer extends tokenize.basic.SentenceTokenizer {
    override stream(): tokenize.SentenceStream {
        return new ChunkSentenceStream(super.stream());
    }
}
