/**
 * @module Agent
 * Dual-pane chat container: Navbar, MessageBubbles, Chat input (ADR 0034).
 * Questionnaire gate footer opens from getMoreInfoQuestions (C10 stubs).
 * Depends on: Conversation, Chat, Navbar, MessageBubbles, LiveAgentProgress.
 * Used by: DashboardChatPanel.
 */
"use client";

import {
    Conversation,
    ConversationContent,
    ConversationEmptyState,
    ConversationScrollButton,
} from "@/components/ai-elements/conversation";
import { MessageSquare } from "lucide-react";
import { useRef, useLayoutEffect, useState, useMemo, useCallback } from "react";
import type { ChatStatus, FileUIPart } from "ai";
import { useIsMobile } from "@/hooks/use-mobile";
import { quickModifyProgramSuggestionChips } from "@/assets/constants/suggestions";
import {
    onChatThreadPointerCancel,
    onChatThreadPointerDown,
    onChatThreadPointerUp,
} from "@/components/artifact-builder/utils/chat-keyboard";
import { Chat } from "./Chat";
import { Navbar } from "./Navbar";
import { MessageBubbles } from "./MessageBubbles";
import { LiveAgentProgress } from "./LiveAgentProgress";

/** Props for the hollow agent container. */
interface IProps {
    search: string;
    sidebarPosition: "left" | "right";
    onTogglePosition: () => void;
    onToggleExpand: () => void;
    onToggleHide?: () => void;
    isExpanded: boolean;
    artifactProgram: TArtifactDay[];
    artifactDocument: TChatArtifactDocument;
    commitWithUndo: (
        next: TArtifactDay[],
        options?: { recordUndo?: boolean; proposalMarkKeys?: number[] },
    ) => void;
    commitDocumentWithUndo: (
        next: TChatArtifactDocument,
        options?: { recordUndo?: boolean; proposalMarkKeys?: number[] },
    ) => void;
    messages: TChatMessage[];
    setMessages: (messages: TChatMessage[] | ((messages: TChatMessage[]) => TChatMessage[])) => void;
    sendMessageWithContext: TSendMessageWithContext;
    isBuilding: boolean;
    handleIsBuilding: (isBuilding: boolean) => void;
    isLoading: boolean;
    error: Error | null;
    onRetry: () => void;
    onClearError: () => void;
    retryCount: number;
    maxRetries: number;
    onTimeoutError: () => void;
    status?: ChatStatus;
    handleSubmit: (text: string, files?: FileUIPart[]) => void;
    handleStop: () => void;
    onBuildComplete?: () => void;
    appliedMutateArtifactKeys: ReadonlySet<string>;
    markMutateArtifactKeysApplied: (keys: readonly string[]) => void;
}

function formatQuestionnaireAnswerValue(value: string | string[]): string {
    if (Array.isArray(value)) return value.join(", ");
    if (value.startsWith("other:")) return value.slice("other:".length).trim() || value;
    return value;
}

function formatQuestionnaireSubmitText(
    answers: Record<string, string | string[]>,
): string {
    const lines = Object.entries(answers)
        .filter(([, value]) => {
            if (Array.isArray(value)) return value.length > 0;
            return value.trim().length > 0;
        })
        .map(([id, value]) => `- ${id}: ${formatQuestionnaireAnswerValue(value)}`);
    if (lines.length === 0) {
        return "I submitted the questionnaire.";
    }
    return `Here are my preferences:\n${lines.join("\n")}`;
}

/** Renders Navbar, conversation area, live progress, and Chat. */
export const Agent: React.FC<IProps> = (props) => {
    const {
        sidebarPosition,
        onTogglePosition,
        onToggleExpand,
        onToggleHide,
        isExpanded,
        artifactProgram,
        artifactDocument,
        commitDocumentWithUndo,
        messages,
        setMessages,
        sendMessageWithContext,
        isBuilding,
        handleIsBuilding,
        isLoading,
        error,
        onRetry,
        onClearError,
        retryCount,
        maxRetries,
        onTimeoutError,
        status: chatStatus,
        handleSubmit,
        handleStop,
        onBuildComplete,
        appliedMutateArtifactKeys,
        markMutateArtifactKeysApplied,
    } = props;

    const chatFooterRef = useRef<HTMLDivElement>(null);
    const [measuredFooterHeight, setMeasuredFooterHeight] = useState<number | null>(null);
    const [dismissedForMessageId, setDismissedForMessageId] = useState<string | null>(null);
    const isMobile = useIsMobile();

    useLayoutEffect(() => {
        if (!isMobile) return;
        const el = chatFooterRef.current;
        if (!el) return;
        const observer = new ResizeObserver((entries) => {
            const height = entries[0]?.borderBoxSize?.[0]?.blockSize ?? entries[0]?.contentRect.height;
            if (height != null) setMeasuredFooterHeight(Math.max(220, height));
        });
        observer.observe(el);
        return () => observer.disconnect();
    }, [isMobile]);

    const footerPad = isMobile && measuredFooterHeight != null ? measuredFooterHeight : undefined;

    const activeQuestionsPayload = useMemo((): TQuestionsPayload | null => {
        const lastAssistant = messages[messages.length - 1];
        if (!lastAssistant || lastAssistant.role !== "assistant" || !lastAssistant.parts?.length) {
            return null;
        }
        const part = lastAssistant.parts.find(
            (p) =>
                typeof p === "object" &&
                p !== null &&
                "type" in p &&
                (p as { type: string }).type === "tool-getMoreInfoQuestions",
        );
        const toolOutput =
            part && "output" in part
                ? (part as { output?: TQuestionsPayload & { questions?: TQuestion[] } }).output
                : undefined;
        if (!toolOutput?.questions || !Array.isArray(toolOutput.questions) || toolOutput.questions.length === 0) {
            return null;
        }
        return {
            questions: toolOutput.questions,
            userRequest: toolOutput.userRequest ?? "",
            reason: toolOutput.reason,
            allowSkip: toolOutput.allowSkip,
            completeAction: toolOutput.completeAction ?? "continue",
            initialAnswers: toolOutput.initialAnswers,
        };
    }, [messages]);

    const lastMessage = messages[messages.length - 1];
    const showQuestionsPayload =
        activeQuestionsPayload &&
        !isLoading &&
        dismissedForMessageId !== lastMessage?.id
            ? activeQuestionsPayload
            : null;

    const handleQuestionsComplete = useCallback(
        (answers: Record<string, string | string[]>) => {
            void sendMessageWithContext(
                { text: formatQuestionnaireSubmitText(answers) },
                { body: { questionnaireAnswers: answers } },
            );
        },
        [sendMessageWithContext],
    );

    const handleQuestionsSkip = useCallback(() => {
        void sendMessageWithContext({ text: "Skipped the questionnaire. Continue." });
    }, [sendMessageWithContext]);

    const handleQuestionsDismiss = useCallback(() => {
        if (lastMessage?.id) setDismissedForMessageId(lastMessage.id);
    }, [lastMessage]);

    return (
        <div className="flex flex-col h-full min-h-0">
            <Navbar
                onTogglePosition={onTogglePosition}
                onToggleExpand={onToggleExpand}
                onToggleHide={onToggleHide}
                isExpanded={isExpanded}
                sidebarPosition={sidebarPosition}
            />
            <div
                className="flex min-h-0 flex-1 flex-col max-sm:h-full"
                onPointerCancel={onChatThreadPointerCancel}
                onPointerDown={onChatThreadPointerDown}
                onPointerUp={onChatThreadPointerUp}
            >
                <Conversation className="flex-1 min-h-0 max-sm:h-full sm:overflow-hidden">
                    <ConversationContent
                        data-proxima-conversation-pad=""
                        className="min-h-full max-sm:pb-55"
                        style={{ paddingBottom: footerPad }}
                    >
                        <>
                            {messages.length === 0 ? (
                                <ConversationEmptyState
                                    icon={<MessageSquare className="size-12" />}
                                    title="Start a conversation"
                                    description="Type a message below to begin chatting"
                                />
                            ) : (
                                <MessageBubbles
                                    messages={messages}
                                    setMessages={setMessages}
                                    artifactDocument={artifactDocument}
                                    commitDocumentWithUndo={commitDocumentWithUndo}
                                    sendMessage={sendMessageWithContext}
                                    isBuilding={isBuilding}
                                    handleIsBuilding={handleIsBuilding}
                                    isLoading={isLoading}
                                    status={chatStatus}
                                    error={error}
                                    onRetry={onRetry}
                                    onClearError={onClearError}
                                    retryCount={retryCount}
                                    maxRetries={maxRetries}
                                    onTimeoutError={onTimeoutError}
                                    onBuildComplete={onBuildComplete}
                                    appliedMutateArtifactKeys={appliedMutateArtifactKeys}
                                    markMutateArtifactKeysApplied={markMutateArtifactKeysApplied}
                                />
                            )}
                            <LiveAgentProgress
                                messages={messages}
                                status={chatStatus}
                                isLoading={isLoading}
                                className="mx-auto w-full max-w-3xl px-4 pt-2 md:px-6"
                            />
                        </>
                        <div data-proxima-chat-keyboard-hide="">
                            <ConversationScrollButton className="absolute bottom-4 right-5 z-50 shadow-xs" />
                        </div>
                    </ConversationContent>
                </Conversation>
            </div>
            <Chat
                ref={chatFooterRef}
                isLoading={isLoading}
                handleSubmit={handleSubmit}
                handleStop={handleStop}
                showSuggestions={
                    messages.length === 0 && !isLoading && showQuestionsPayload == null
                }
                suggestionChips={
                    artifactProgram.length > 0 ? quickModifyProgramSuggestionChips : undefined
                }
                isBuilding={isBuilding}
                questionsPayload={showQuestionsPayload}
                onQuestionsComplete={handleQuestionsComplete}
                onQuestionsSkip={handleQuestionsSkip}
                onQuestionsDismiss={handleQuestionsDismiss}
            />
        </div>
    );
};
