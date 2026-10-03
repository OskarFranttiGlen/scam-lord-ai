import { describe, expect, it } from "vitest";

import {
    buildDeveloperToolErrorFeedback,
    buildToolErrorPayload,
    getMutateArtifactFailureSeverity,
    summarizeToolError,
} from "../tool-error";

describe("buildToolErrorPayload", () => {
    it("serializes tool, errorText, and output for clipboard", () => {
        const payload = buildToolErrorPayload("mutateArtifact", {
            errorText: "batch rejected",
            output: {
                error: "Artifact mutation batch failed",
                failures: [{ index: 0, op: "add_day", reason: "Maximum 7 days per week" }],
            },
        });

        expect(JSON.parse(payload)).toEqual({
            tool: "mutateArtifact",
            errorText: "batch rejected",
            output: {
                error: "Artifact mutation batch failed",
                failures: [{ index: 0, op: "add_day", reason: "Maximum 7 days per week" }],
            },
        });
    });
});

describe("buildDeveloperToolErrorFeedback", () => {
    it("includes chatId, tool, summary, and JSON payload", () => {
        const ctx = {
            errorText: "batch rejected",
            output: {
                error: "Artifact mutation batch failed",
                failures: [{ index: 0, op: "add_day", reason: "Maximum 7 days per week" }],
            },
        };
        const chatId = "11111111-1111-4111-8111-111111111111";

        const feedback = buildDeveloperToolErrorFeedback("mutateArtifact", ctx, chatId);

        expect(feedback).toContain("Tool error report");
        expect(feedback).toContain(`Chat ID: ${chatId}`);
        expect(feedback).toContain("Tool: mutateArtifact");
        expect(feedback).toContain("Summary: We couldn't apply that change: Maximum 7 days per week");
        expect(feedback).toContain(buildToolErrorPayload("mutateArtifact", ctx));
    });

    it("uses unknown when chatId is empty", () => {
        const feedback = buildDeveloperToolErrorFeedback("mutateArtifact", { errorText: "timeout" }, "  ");

        expect(feedback).toContain("Chat ID: unknown");
    });
});

describe("getMutateArtifactFailureSeverity", () => {
    it("treats validation batch failures as warnings", () => {
        expect(
            getMutateArtifactFailureSeverity({
                output: {
                    error: "Artifact mutation batch failed",
                    failures: [{ index: 0, op: "upsert_item", reason: "day not found" }],
                },
            }),
        ).toBe("warning");
    });

    it("treats SDK input validation as warnings", () => {
        const sdkError =
            'Invalid input for tool mutateArtifact: Type validation failed: Value: {"operations":[{"op":"add_day","weekIndex":0}]}.' +
            ' Error message: [{"expected":"string","code":"invalid_type","path":["operations",0,"title"],"message":"Invalid input: expected string, received undefined"}]';

        expect(getMutateArtifactFailureSeverity({ errorText: sdkError })).toBe("warning");
        expect(
            getMutateArtifactFailureSeverity({ errorText: "validation_error" }),
        ).toBe("warning");
    });

    it("treats unexpected batch validation errors as errors", () => {
        expect(
            getMutateArtifactFailureSeverity({
                output: {
                    error: "Failed to validate mutation batch",
                    failures: [{ index: 0, op: "add_day", reason: "Unexpected server error" }],
                },
            }),
        ).toBe("error");
    });

    it("treats infrastructure errorText as errors", () => {
        expect(
            getMutateArtifactFailureSeverity({
                errorText: "Network timeout while validating batch",
            }),
        ).toBe("error");
    });
});

describe("summarizeToolError", () => {
    it("prefers output.message when present", () => {
        const summary = summarizeToolError("mutateArtifact", {
            output: {
                error: "readArtifact_required",
                message: "Call readArtifact before mutateArtifact when the artifact already has weeks.",
            },
        });

        expect(summary).toBe(
            "Call readArtifact before mutateArtifact when the artifact already has weeks.",
        );
    });

    it("humanizes mutateArtifact failures", () => {
        const summary = summarizeToolError("mutateArtifact", {
            output: {
                error: "Artifact mutation batch failed",
                failures: [{ index: 0, op: "add_day", reason: "Maximum 7 days per week" }],
            },
        });

        expect(summary).toBe("We couldn't apply that change: Maximum 7 days per week");
    });

    it("maps known output.error codes to friendly copy", () => {
        const summary = summarizeToolError("mutateArtifact", {
            output: { error: "Failed to validate mutation batch" },
        });

        expect(summary).toBe("We couldn't apply that change.");
    });

    it("uses short human errorText when not JSON", () => {
        const summary = summarizeToolError("mutateArtifact", {
            errorText: "Network timeout while validating batch",
        });

        expect(summary).toBe("We couldn't apply that change: Network timeout while validating batch");
    });

    it("parses JSON errorText and extracts message", () => {
        const summary = summarizeToolError("getMoreInfoQuestions", {
            errorText: JSON.stringify({
                error: "Failed to load questions",
                message: "Catalog unavailable",
            }),
        });

        expect(summary).toBe("Catalog unavailable");
    });

    it("parses failure-style errorText", () => {
        const summary = summarizeToolError("mutateArtifact", {
            errorText: "[0] add_day: Maximum 7 days per week",
        });

        expect(summary).toBe("We couldn't apply that change: Maximum 7 days per week");
    });

    it("summarizes SDK validation dumps instead of showing raw JSON", () => {
        const sdkError =
            'Invalid input for tool mutateArtifact: Type validation failed: Value: {"operations":[{"op":"delete_item","weekIndex":0}]}.' +
            ' Error message: [{"expected":"string","code":"invalid_type","path":["operations",0,"dayId"],"message":"Invalid input: expected string, received undefined"}]';

        const summary = summarizeToolError("mutateArtifact", { errorText: sdkError });

        expect(summary).toBe(
            "We couldn't apply that change: A required field (dayId) was missing.",
        );
        expect(summary).not.toContain("Type validation failed");
        expect(summary).not.toContain('"invalid_type"');
    });

    it("humanizes missing required number SDK validation errors", () => {
        const sdkError =
            'Invalid input for tool mutateArtifact: Type validation failed: Value: {"operations":[{"op":"delete_week"}]}.' +
            ' Error message: [{"expected":"number","code":"invalid_type","path":["operations",0,"weekIndex"],"message":"Invalid input: expected number, received undefined"}]';

        const summary = summarizeToolError("mutateArtifact", { errorText: sdkError });

        expect(summary).toBe(
            "We couldn't apply that change: A required number (weekIndex) was missing.",
        );
    });

    it("humanizes stringified nested object SDK validation errors", () => {
        const sdkError =
            'Invalid input for tool mutateArtifact: Type validation failed: Value: {"operations":[{"op":"upsert_item","item":"{\\"title\\":\\"x\\"}"}]}.' +
            ' Error message: [{"expected":"object","code":"invalid_type","path":["operations",0,"item"],"message":"Invalid input: expected object, received string"}]';

        const summary = summarizeToolError("mutateArtifact", { errorText: sdkError });

        expect(summary).toBe(
            "We couldn't apply that change: item must be a nested object in tool args, not a JSON string",
        );
    });

    it("summarizes the stream class code when Zod details never reached the client", () => {
        const summary = summarizeToolError("mutateArtifact", {
            errorText: "validation_error",
            output: null,
        });

        expect(summary).toBe("We couldn't apply that change: The request format wasn't valid.");
        expect(summary).not.toContain("validation_error");
    });

    it("falls back to tool-specific default", () => {
        expect(summarizeToolError("mutateArtifact", {})).toBe("We couldn't apply that change.");
        expect(summarizeToolError("unknownTool", {})).toBe(
            "Something went wrong. Try again or rephrase your request.",
        );
    });
});
