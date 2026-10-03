/**
 * @module MessageBubbles
 * Chat message list (ADR 0034 / 05): user/assistant text, reasoning, tool chrome,
 * mutateArtifact empty-land + Mutation proposal Accept/Reject.
 * Depends on: message, tool, reasoning, attachments, AgentGenerationError,
 *   MutationProposalCard, mutation-proposal helpers.
 * Used by: Agent.
 */
import { useCallback, useEffect, useState } from "react";
import {
    Message,
    MessageAction,
    MessageActions,
    MessageContent,
    MessageResponse,
} from "@/components/ai-elements/message";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import { Copy, Pencil, Trash, FileText } from "lucide-react";
import { type ChatStatus, type FileUIPart } from "ai";
import {
    Reasoning,
    ReasoningContent,
    ReasoningTrigger,
} from "@/components/ai-elements/reasoning";
import { Tool, ToolContent, ToolHeader } from "@/components/ai-elements/tool";
import type { TToolPart } from "@/components/ai-elements/tool";
import { summarizeToolError } from "./tool-error";
import {
    Attachments,
    Attachment,
    AttachmentPreview,
    AttachmentInfo,
} from "@/components/ai-elements/attachments";
import { AgentGenerationError } from "./AgentGenerationError";
import { parseUserMessageWithSpreadsheets, truncateFilename } from "./helpers";
import {
    acceptMutationProposal,
    buildMutationProposalRecipe,
    collectMutationProposal,
    readStoredMutationProposalRecipe,
    resolveMutationProposalDecision,
    tryLandEmptyArtifactMutations,
    withMutationProposalDecision,
    type IMutationProposal,
    type TMutationProposalRecipe,
} from "@/components/artifact-builder/utils/mutation-proposal";
import {
    focusDashboardChatInput,
    MutationProposalCard,
} from "./MutationProposalCard";
import type { TCommitArtifactWithUndoOptions } from "@/components/artifact-builder/mutations/types";

interface IProps {
    messages: TChatMessage[];
    setMessages: (messages: TChatMessage[] | ((messages: TChatMessage[]) => TChatMessage[])) => void;
    sendMessage: TSendMessageWithContext;
    isBuilding: boolean;
    handleIsBuilding: (isBuilding: boolean) => void;
    isLoading: boolean;
    status?: ChatStatus;
    error: Error | null;
    onRetry: () => void;
    onClearError: () => void;
    retryCount: number;
    maxRetries: number;
    onTimeoutError: () => void;
    artifactDocument: TChatArtifactDocument;
    commitDocumentWithUndo: (
        next: TChatArtifactDocument,
        options?: TCommitArtifactWithUndoOptions,
    ) => void;
    onBuildComplete?: () => void;
    appliedMutateArtifactKeys: ReadonlySet<string>;
    markMutateArtifactKeysApplied: (keys: readonly string[]) => void;
}

function getPartText(part: { type?: string; text?: string }): string {
    return part.type === "text" && typeof part.text === "string" ? part.text : "";
}

type TProposalCardModel = {
    decision: "accepted" | "pending" | "rejected" | null;
    recipe: TMutationProposalRecipe;
    showActions: boolean;
    pendingProposal: IMutationProposal | null;
};

/**
 * Recipe + Accept/Reject for a standalone Mutation proposal once the turn
 * finishes. Returns null when this message has no standalone mutateArtifact.
 */
function resolveProposalCardModel(input: {
    message: TChatMessage;
    laterMessages: TChatMessage[];
    pendingProposal: IMutationProposal | null;
    status: ChatStatus | undefined;
}): TProposalCardModel | null {
    const storedRecipe = readStoredMutationProposalRecipe(input.message);
    let hasMutate = false;
    for (const candidate of input.message.parts ?? []) {
        if (candidate.type !== "tool-mutateArtifact") continue;
        const output = (candidate as { output?: { operations?: unknown[]; error?: string } }).output;
        if (output?.operations?.length && !output.error) {
            hasMutate = true;
            break;
        }
    }
    if (!hasMutate && !storedRecipe) return null;

    const decision = resolveMutationProposalDecision(input.message, input.laterMessages);
    const recipe = storedRecipe
        ?? (input.pendingProposal
            && input.pendingProposal.messageIds.includes(input.message.id)
            ? buildMutationProposalRecipe(input.pendingProposal.operations)
            : buildMutationProposalRecipe(undefined));

    if (recipe.lines.length === 0 && !storedRecipe) return null;

    return {
        decision,
        recipe,
        showActions:
            decision !== "accepted"
            && decision !== "rejected"
            && input.status !== "streaming"
            && Boolean(input.pendingProposal?.messageIds.includes(input.message.id)),
        pendingProposal: input.pendingProposal,
    };
}

/**
 * Renders user + assistant chat bubbles with mutateArtifact land + proposals.
 */
export function MessageBubbles(props: IProps) {
    const {
        messages,
        setMessages,
        isLoading,
        status,
        error,
        onRetry,
        onClearError,
        retryCount,
        maxRetries,
        onTimeoutError,
        artifactDocument,
        commitDocumentWithUndo,
        handleIsBuilding,
        onBuildComplete,
        appliedMutateArtifactKeys,
        markMutateArtifactKeysApplied,
    } = props;

    const [editingId, setEditingId] = useState<string | null>(null);
    const [editDraft, setEditDraft] = useState("");

    // External sync: mutateArtifact tool outputs → editor document (empty land).
    useEffect(() => {
        const landed = tryLandEmptyArtifactMutations(
            messages,
            status,
            artifactDocument,
            appliedMutateArtifactKeys,
            markMutateArtifactKeysApplied,
            commitDocumentWithUndo,
        );
        if (landed) {
            handleIsBuilding(false);
            onBuildComplete?.();
        }
    }, [
        messages,
        status,
        artifactDocument,
        appliedMutateArtifactKeys,
        markMutateArtifactKeysApplied,
        commitDocumentWithUndo,
        handleIsBuilding,
        onBuildComplete,
    ]);

    const pendingProposal = collectMutationProposal(
        messages,
        status,
        artifactDocument,
        appliedMutateArtifactKeys,
    );

    const handleAcceptProposal = useCallback(() => {
        const proposal = collectMutationProposal(
            messages,
            status,
            artifactDocument,
            appliedMutateArtifactKeys,
        );
        if (!proposal) return;
        const recipe = buildMutationProposalRecipe(proposal.operations);
        const committed = acceptMutationProposal(
            artifactDocument,
            proposal,
            markMutateArtifactKeysApplied,
            commitDocumentWithUndo,
        );
        if (!committed) {
            const expired = withMutationProposalDecision(
                messages,
                proposal.messageIds,
                "rejected",
                recipe,
            );
            setMessages(expired);
            focusDashboardChatInput();
            return;
        }
        const next = withMutationProposalDecision(
            messages,
            proposal.messageIds,
            "accepted",
            recipe,
        );
        setMessages(next);
    }, [
        appliedMutateArtifactKeys,
        markMutateArtifactKeysApplied,
        artifactDocument,
        commitDocumentWithUndo,
        messages,
        setMessages,
        status,
    ]);

    const handleRejectProposal = useCallback((messageId: string) => {
        const proposal = collectMutationProposal(
            messages,
            status,
            artifactDocument,
            appliedMutateArtifactKeys,
        );
        const messageIds = proposal?.messageIds?.length ? proposal.messageIds : [messageId];
        const recipe = proposal
            ? buildMutationProposalRecipe(proposal.operations)
            : { lines: [] as string[] };
        if (proposal) {
            markMutateArtifactKeysApplied(proposal.keys);
        }
        const next = withMutationProposalDecision(messages, messageIds, "rejected", recipe);
        setMessages(next);
        focusDashboardChatInput();
    }, [
        appliedMutateArtifactKeys,
        markMutateArtifactKeysApplied,
        artifactDocument,
        messages,
        setMessages,
        status,
    ]);

    return (
        <div className="mx-auto flex w-full max-w-3xl flex-col gap-4 px-4 py-4 md:px-6">
            {messages.map((message, messageIndex) => {
                const isUser = message.role === "user";
                const textParts = (message.parts ?? [])
                    .map(getPartText)
                    .filter(Boolean)
                    .join("\n");
                const { displayText, spreadsheetLabels } = isUser
                    ? parseUserMessageWithSpreadsheets(textParts)
                    : { displayText: textParts, spreadsheetLabels: [] as string[] };
                const fileParts = (message.parts ?? []).filter(
                    (part): part is FileUIPart & { type: "file" } =>
                        part != null &&
                        typeof part === "object" &&
                        "type" in part &&
                        (part as { type: string }).type === "file",
                );
                const laterMessages = messages.slice(messageIndex + 1);
                const proposalCard = !isUser
                    ? resolveProposalCardModel({
                        message,
                        laterMessages,
                        pendingProposal,
                        status,
                    })
                    : null;

                return (
                    <Message
                        key={message.id}
                        from={isUser ? "user" : "assistant"}
                        className={cn(isUser && "items-end")}
                    >
                        <MessageContent>
                            {isUser && editingId === message.id ? (
                                <div className="flex w-full flex-col gap-2">
                                    <Textarea
                                        value={editDraft}
                                        onChange={(e) => setEditDraft(e.target.value)}
                                        className="min-h-24"
                                    />
                                    <div className="flex gap-2">
                                        <Button
                                            size="sm"
                                            onClick={() => {
                                                setMessages((prev) =>
                                                    prev.map((m) =>
                                                        m.id === message.id
                                                            ? {
                                                                ...m,
                                                                parts: [{ type: "text", text: editDraft }],
                                                            }
                                                            : m,
                                                    ),
                                                );
                                                setEditingId(null);
                                            }}
                                        >
                                            Save
                                        </Button>
                                        <Button
                                            size="sm"
                                            variant="ghost"
                                            onClick={() => setEditingId(null)}
                                        >
                                            Cancel
                                        </Button>
                                    </div>
                                </div>
                            ) : (
                                <>
                                    {displayText ? (
                                        <MessageResponse>{displayText}</MessageResponse>
                                    ) : null}
                                    {spreadsheetLabels.map((label) => (
                                        <div
                                            key={label}
                                            className="mt-1 flex items-center gap-1 text-xs text-muted-foreground"
                                        >
                                            <FileText className="size-3" />
                                            {truncateFilename(label)}
                                        </div>
                                    ))}
                                    {fileParts.length > 0 ? (
                                        <Attachments className="mt-2">
                                            {fileParts.map((file, index) => (
                                                <Attachment
                                                    key={`${message.id}-file-${index}`}
                                                    data={{
                                                        id: `${message.id}-file-${index}`,
                                                        type: "file",
                                                        url: file.url,
                                                        mediaType: file.mediaType,
                                                        filename: file.filename,
                                                    }}
                                                >
                                                    <AttachmentPreview />
                                                    <AttachmentInfo />
                                                </Attachment>
                                            ))}
                                        </Attachments>
                                    ) : null}
                                    {(message.parts ?? []).map((part, index) => {
                                        if (
                                            part == null ||
                                            typeof part !== "object" ||
                                            !("type" in part)
                                        ) {
                                            return null;
                                        }
                                        const typed = part as { type: string };
                                        if (typed.type === "reasoning") {
                                            const reasoning = part as {
                                                type: "reasoning";
                                                text?: string;
                                            };
                                            return (
                                                <Reasoning key={`${message.id}-r-${index}`}>
                                                    <ReasoningTrigger />
                                                    <ReasoningContent>
                                                        {reasoning.text ?? ""}
                                                    </ReasoningContent>
                                                </Reasoning>
                                            );
                                        }
                                        if (typed.type.startsWith("tool-")) {
                                            const toolPart = part as TToolPart;
                                            const toolState =
                                                "state" in toolPart
                                                    ? (toolPart.state as string)
                                                    : "output-available";
                                            const isError = toolState === "output-error";
                                            return (
                                                <Tool key={`${message.id}-t-${index}`}>
                                                    <ToolHeader
                                                        type={typed.type as `tool-${string}`}
                                                        state={
                                                            toolState as
                                                                | "input-streaming"
                                                                | "input-available"
                                                                | "output-available"
                                                                | "output-error"
                                                        }
                                                        title={typed.type.replace(/^tool-/, "")}
                                                    />
                                                    {isError ? (
                                                        <ToolContent>
                                                            <p className="text-sm text-muted-foreground">
                                                                {summarizeToolError(
                                                                    typed.type.replace(/^tool-/, ""),
                                                                    {
                                                                        errorText:
                                                                            "errorText" in toolPart
                                                                                ? String(
                                                                                    (toolPart as { errorText?: string })
                                                                                        .errorText ?? "",
                                                                                )
                                                                                : undefined,
                                                                        output:
                                                                            "output" in toolPart
                                                                                ? (toolPart as { output?: unknown })
                                                                                    .output
                                                                                : undefined,
                                                                    },
                                                                )}
                                                            </p>
                                                        </ToolContent>
                                                    ) : null}
                                                </Tool>
                                            );
                                        }
                                        return null;
                                    })}
                                    {proposalCard ? (
                                        <div key={`${message.id}-mutate-proposal`}>
                                            <MutationProposalCard
                                                recipe={proposalCard.recipe}
                                                showActions={proposalCard.showActions}
                                                onAccept={handleAcceptProposal}
                                                onReject={() => handleRejectProposal(message.id)}
                                            />
                                        </div>
                                    ) : null}
                                </>
                            )}
                        </MessageContent>
                        {isUser && editingId !== message.id ? (
                            <MessageActions>
                                <MessageAction
                                    tooltip="Copy"
                                    onClick={() => {
                                        void navigator.clipboard.writeText(displayText);
                                    }}
                                >
                                    <Copy className="size-3.5" />
                                </MessageAction>
                                <MessageAction
                                    tooltip="Edit"
                                    onClick={() => {
                                        setEditingId(message.id);
                                        setEditDraft(displayText);
                                    }}
                                >
                                    <Pencil className="size-3.5" />
                                </MessageAction>
                                <MessageAction
                                    tooltip="Delete"
                                    onClick={() => {
                                        setMessages((prev) =>
                                            prev.filter((m) => m.id !== message.id),
                                        );
                                    }}
                                >
                                    <Trash className="size-3.5" />
                                </MessageAction>
                            </MessageActions>
                        ) : null}
                    </Message>
                );
            })}
            {error ? (
                <AgentGenerationError
                    error={error}
                    onRetry={onRetry}
                    onClearError={onClearError}
                    retryCount={retryCount}
                    maxRetries={maxRetries}
                    onTimeoutError={onTimeoutError}
                    isLoading={isLoading}
                    status={status}
                />
            ) : null}
        </div>
    );
}
