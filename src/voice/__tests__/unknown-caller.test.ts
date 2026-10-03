import { describe, expect, it, vi } from "vitest";

import {
    UNKNOWN_CALLER_ASK_AGAIN,
    UNKNOWN_CALLER_CLOSING,
    runUnknownCallerTurn,
    type TUnknownCallerModel,
} from "@/voice/unknown-caller";

const MONEY_WORDS = /dollar|balance|\$|\d|owe|invoice/i;

function model(result: Awaited<ReturnType<TUnknownCallerModel>>) {
    return vi.fn<TUnknownCallerModel>(async () => result);
}

describe("runUnknownCallerTurn", () => {
    it("asks for whatever is still missing after the first answer", async () => {
        const ask = model({ reply: "Thanks, Pat. Which property are you calling about?", haveName: true, haveProperty: false });

        const turn = await runUnknownCallerTurn({
            transcriptLines: ["Agent: Thanks for calling.", "Caller: This is Pat."],
            callerTurns: 1,
            model: ask,
        });

        expect(turn).toEqual({ reply: "Thanks, Pat. Which property are you calling about?", done: false });
    });

    it("closes politely once it has both name and property", async () => {
        const turn = await runUnknownCallerTurn({
            transcriptLines: ["Caller: Pat Doe, at Maple Court."],
            callerTurns: 1,
            model: model({ reply: "Great, thanks!", haveName: true, haveProperty: true }),
        });

        expect(turn).toEqual({ reply: UNKNOWN_CALLER_CLOSING, done: true });
        expect(UNKNOWN_CALLER_CLOSING).toMatch(/call you back/);
    });

    it("closes after the second caller turn without calling the model", async () => {
        const ask = model({ reply: "unused", haveName: false, haveProperty: false });

        const turn = await runUnknownCallerTurn({ transcriptLines: [], callerTurns: 2, model: ask });

        expect(turn).toEqual({ reply: UNKNOWN_CALLER_CLOSING, done: true });
        expect(ask).not.toHaveBeenCalled();
    });

    it("never speaks a reply that mentions money or account details", async () => {
        const turn = await runUnknownCallerTurn({
            transcriptLines: ["Caller: What's my balance?"],
            callerTurns: 1,
            model: model({ reply: "Your balance is 1,840 dollars.", haveName: false, haveProperty: false }),
        });

        expect(turn).toEqual({ reply: UNKNOWN_CALLER_ASK_AGAIN, done: false });
        expect(UNKNOWN_CALLER_ASK_AGAIN).not.toMatch(MONEY_WORDS);
    });

    it("falls back to a scripted question when the model fails", async () => {
        const turn = await runUnknownCallerTurn({
            transcriptLines: ["Caller: Hello?"],
            callerTurns: 1,
            model: vi.fn<TUnknownCallerModel>(async () => {
                throw new Error("gateway down");
            }),
            log: { warn: vi.fn() },
        });

        expect(turn).toEqual({ reply: UNKNOWN_CALLER_ASK_AGAIN, done: false });
    });
});
