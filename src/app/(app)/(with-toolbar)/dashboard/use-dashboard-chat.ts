"use client";

import { useCallback, useRef, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { toast } from "sonner";
import { useChat } from "@ai-sdk/react";
import {
    DefaultChatTransport,
    type ChatStatus,
    type FileUIPart,
} from "ai";
import posthog from "posthog-js";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import type { User } from "@supabase/supabase-js";
import {
    ensureChatSessionOnSend,
    migrateAnonymousThreadToChat,
    persistChatHistoryAfterTurn,
    resolveChatSessionId,
} from "@/api/chat-history";
import { requestGeneratedChatTitle } from "@/api/chat-title-request";
import {
    applyDashboardMintUrlUpdate,
    stripSearchFromDashboardUrl,
} from "@/lib/dashboard-url";
import { recordAnonymousLlmRequest } from "@/api/feature-limits";
import {
    CHAT_MESSAGES_KEY,
    LONG_PROMPT_PLACEHOLDER,
} from "@/assets/constants/ui-constants";
import { withRenewsOn } from "@/lib/format-usage-reset-date";
import { parseUsageCapFromChatError } from "@/lib/usage-cap";
import {
    classifyAgentErrorClass,
    truncateForAgentTelemetry,
} from "@/lib/agent-error-classes";
import {
    clearLongPromptFromSessionStorage,
    readPendingAttachmentFileParts,
    resolveInitialPromptText,
} from "./initial-prompt";
import type { IChatEntryPlan } from "./resolve-chat-entry";
import { resolvePersistChatId, shouldRunAutoSend, isExplicitNewChatArrival } from "./resolve-chat-entry";
import { getAgentDebugMode } from "@/lib/agent-debug-mode";

// ---------------------------------------------------------------------------
// Types & constants
// ---------------------------------------------------------------------------

function getMessageText(message: unknown): string {
    if (message == null || typeof message !== "object") return "";
    const m = message as { text?: string; parts?: { text?: string }[] };
    if (typeof m.text === "string") return m.text.trim();
    if (Array.isArray(m.parts)) {
        return m.parts
            .map((p) => (typeof p?.text === "string" ? p.text : ""))
            .join(" ")
            .trim();
    }
    return "";
}

function getTextFromChatMessage(message: unknown): string {
    return getMessageText(message);
}

function isMessageAboutProgram(text: string): boolean {
    const normalized = text.trim().toLowerCase();
    if (!normalized) return false;
    return /\b(program|workout|week|day|exercise|routine|plan)\b/.test(normalized);
}

function programHasExerciseRows(program: readonly TArtifactDay[]): boolean {
    return program.some((day) => (day.exercises?.length ?? 0) > 0);
}

const chatTransport = new DefaultChatTransport({ api: "/api/chat" });
const MAX_RETRIES = 2;

export interface IUseDashboardChatOptions {
    user: User | null;
    artifactProgram: TArtifactDay[];
    artifactDocument: TChatArtifactDocument;
    isMobile: boolean;
    setMobileTab: (tab: string) => void;
    /** Snapshot for keyed remount (chat history or anonymous restore). */
    initialMessages: TChatMessage[];
    /** True once shared-program fetch finished or was not needed (no valid `shareId`). */
    sharedProgramLoadAttempted: boolean;
    /** Effective chat id from URL (`?chat=`). */
    chatId: string;
    /** Arrival bootstrap plan from `resolveChatEntryPlan`. */
    chatEntryPlan: IChatEntryPlan;
}

export interface IProps {
    messages: TChatMessage[];
    setMessages: (
        messages:
            | TChatMessage[]
            | ((msgs: TChatMessage[]) => TChatMessage[]),
    ) => void;
    sendMessageWithContext: TSendMessageWithContext;
    clearMessages: () => void;
    /** URL `?chat=` or mint ref until URL propagates (persist/connect paths). */
    getPersistChatId: () => string;
    handleSubmit: (text: string, files?: FileUIPart[]) => void;
    handleStop: () => void;
    isBuilding: boolean;
    handleIsBuilding: (isBuilding: boolean) => void;
    isLoading: boolean;
    status: ChatStatus;
    activeError: Error | null;
    onRetry: () => void;
    onClearError: () => void;
    retryCount: number;
    maxRetries: number;
    onTimeoutError: () => void;
    onBuildComplete: () => void;
    trySendInitialPrompt: () => void;
    tryRunSignInMigration: () => Promise<void>;
    /** Session keys for mutateArtifact empty-land / Accept (survives mobile tab unmount). */
    appliedMutateArtifactKeys: ReadonlySet<string>;
    markMutateArtifactKeysApplied: (keys: readonly string[]) => void;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Anonymous session restore - read once at `useChat` init when `!chatId && !user`. */
export function readAnonymousChatMessages(): TChatMessage[] {
    if (typeof window === "undefined") return [];

    try {
        const stored = localStorage.getItem(CHAT_MESSAGES_KEY);
        if (!stored) return [];

        const parsed = JSON.parse(stored);
        return Array.isArray(parsed) && parsed.length > 0 ? (parsed as TChatMessage[]) : [];
    } catch {
        return [];
    }
}

function logAgentError(
    error: unknown,
    userId: string | undefined,
    chatSessionId: string | undefined,
): void {
    const normalized = error instanceof Error ? error : new Error(String(error));
    const errorClass = classifyAgentErrorClass(normalized);
    posthog?.capture?.("ai_agent_error", {
        user: userId ?? "user_id_unknown",
        errorMessage: truncateForAgentTelemetry(normalized.message || "unknown", 500),
        errorClass,
        chatSessionId: chatSessionId?.trim() || undefined,
    });
}

interface IMessageContextBodyInput {
    messageText: string;
    artifactProgram: TArtifactDay[];
    artifactDocument: TChatArtifactDocument;
    chatId: string;
    debugMode: boolean;
}

/**
 * A grid with rows only in week 1, such as a **Hevy share import** seed. Expanding
 * it reads week 1 from the request, and "yes, expand it" is not program talk.
 *
 * @param artifactProgram - Current builder grid
 */
function isOneWeekSeed(artifactProgram: TArtifactDay[]): boolean {
    return programHasExerciseRows(artifactProgram) &&
        artifactProgram.every((routine) => (routine.folder_id ?? 0) === 0 || (routine.exercises?.length ?? 0) === 0);
}

/**
 * Always send the Chat artifact document snapshot for CRUD tools.
 * Flat `artifactProgram` remains for transitional clients; prefer document.
 *
 * @param input - Message text + live artifact state
 */
export function buildMessageContextBody(input: IMessageContextBodyInput) {
    const includeProgram = isMessageAboutProgram(input.messageText) || isOneWeekSeed(input.artifactProgram);

    return {
        artifactProgram: includeProgram ? input.artifactProgram : [],
        artifactDocument: input.artifactDocument,
        programHasExercises: programHasExerciseRows(input.artifactProgram),
        chatSessionId: input.chatId || undefined,
        debugMode: input.debugMode,
    };
}

function logJevDebugFromLatestTurn(messages: TChatMessage[]): void {
    const lastAssistant = [...messages].reverse().find((message) => message.role === "assistant");
    if (!lastAssistant) return;
    for (const part of lastAssistant.parts ?? []) {
        if (part.type !== "tool-mutateArtifact") continue;
        if (!("output" in part) || part.output == null || typeof part.output !== "object") continue;
        const jev = (part.output as { jev?: unknown }).jev;
        if (jev) console.log("[jev]", jev);
    }
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

export function useDashboardChat(options: IUseDashboardChatOptions): IProps {
    const {
        user,
        artifactProgram,
        artifactDocument,
        isMobile,
        setMobileTab,
        initialMessages,
        sharedProgramLoadAttempted,
        chatId,
        chatEntryPlan,
    } = options;

    const router = useRouter();
    const pathname = usePathname();
    const queryClient = useQueryClient();
    const searchParams = useSearchParams();

    const search = searchParams.get("search") ?? "";
    const shareId = searchParams.get("shareId") ?? "";

    /** Minted id until URL `?chat=` propagates (send handler only - not render). */
    const pendingMintChatIdRef = useRef("");

    const signInMigrationMutation = useMutation({
        mutationFn: (thread: TChatMessage[]) =>
            migrateAnonymousThreadToChat({
                user: user!,
                messages: thread,
                router,
                pathname,
                searchParams,
            }),
        onSuccess: (result) => {
            if (result.confirmed && user) {
                void queryClient.invalidateQueries({ queryKey: ["chat-ids", user.id] });
                requestGeneratedChatTitle({
                    chatId: result.chatId,
                    userId: user.id,
                    queryClient,
                });
            } else if (!result.confirmed && !migrationFailToastShownRef.current) {
                migrationFailToastShownRef.current = true;
                toast.warning("Couldn't save your chat yet. Messages are still here.");
            }
        },
    });

    const [generationError, setGenerationError] = useState<Error | null>(null);
    const [retryCount, setRetryCount] = useState(0);
    const [isBuilding, setIsBuilding] = useState(false);

    const lastHandledSearchRef = useRef("");
    const migrationAttemptedRef = useRef(false);
    const migrationFailToastShownRef = useRef(false);
    /** Survives MessageBubbles unmount when switching mobile tabs (Radix Tabs). */
    const [appliedMutateArtifactKeys, setAppliedMutateArtifactKeys] = useState(
        () => new Set<string>(),
    );
    const markMutateArtifactKeysApplied = useCallback((keys: readonly string[]) => {
        if (keys.length === 0) return;
        setAppliedMutateArtifactKeys((prev) => {
            const next = new Set(prev);
            for (const key of keys) next.add(key);
            return next;
        });
    }, []);
    const hasAutoSwitchedToProgramAfterFirstBuildRef = useRef(false);
    const insertFailToastShownForChatIds = useRef(new Set<string>());

    const resetChatSessionRefs = useCallback(() => {
        setAppliedMutateArtifactKeys(new Set());
        hasAutoSwitchedToProgramAfterFirstBuildRef.current = false;
    }, []);

    const { messages, sendMessage, setMessages, status, stop, error } = useChat<TChatMessage>({
        transport: chatTransport,
        messages: initialMessages,
        onFinish: ({ messages: finishedMessages, isAbort, isError }) => {
            if (getAgentDebugMode()) {
                logJevDebugFromLatestTurn(finishedMessages);
            }

            // Server consume runs at request start — refresh shell counter after any
            // authenticated turn that reached the stream (success, error, or abort).
            if (user) {
                void queryClient.invalidateQueries({
                    queryKey: ["feature-limits", user.id],
                });
            }

            const persistChatId = resolvePersistChatId(chatId, pendingMintChatIdRef.current);
            void persistChatHistoryAfterTurn({
                user,
                chatId: persistChatId,
                messages: finishedMessages,
                isAbort,
                isError,
            }).then((result) => {
                if (result === "success" && user && persistChatId) {
                    void queryClient.invalidateQueries({
                        queryKey: ["chat-history", user.id, persistChatId],
                    });
                }
            });
        },
        onError: (err) => {
            const usageCap = parseUsageCapFromChatError(err);
            if (usageCap) {
                toast.error(
                    withRenewsOn("You have run out of credits.", usageCap.resets_on),
                );
                void queryClient.invalidateQueries({
                    queryKey: ["feature-limits", user?.id],
                });
                setIsBuilding(false);
                return;
            }
            console.error("Chat error:", err);
            setGenerationError(err);
            setIsBuilding(false);
            logAgentError(
                err,
                user?.id,
                resolvePersistChatId(chatId, pendingMintChatIdRef.current),
            );
        },
    });

    const clearMessages = useCallback(() => {
        resetChatSessionRefs();
        pendingMintChatIdRef.current = "";
        setMessages([]);
    }, [resetChatSessionRefs, setMessages]);

    // Paywall is toast + UpgradeBanner - do not surface AgentGenerationError retry UI.
    const activeError =
        parseUsageCapFromChatError(error) || parseUsageCapFromChatError(generationError)
            ? null
            : generationError || error || null;
    const isLoading = status === "submitted" || status === "streaming";

    const sendMessageWithContext = useCallback<TSendMessageWithContext>(
        async (message, sendOptions) => {
            if (message == null) return;

            // Authenticated LLM meter lives in POST /api/chat (try_consume). Anonymous
            // still decrements localStorage here - no auth.uid() / period row.
            if (!user) {
                recordAnonymousLlmRequest();
                void queryClient.invalidateQueries({ queryKey: ["feature-limits"] });
            }

            const hadChatIdAtSend = Boolean(chatId);
            // Mint sync so sendMessage (bubble + submitted status / LiveAgentProgress)
            // is not blocked on chat_history exists/insert RTT.
            let sessionChatId = chatId;
            const firstUserText = user ? getMessageText(message) : "";
            if (user && firstUserText.trim()) {
                sessionChatId = resolveChatSessionId(chatId);
                pendingMintChatIdRef.current = sessionChatId;
            }

            const messageText = getTextFromChatMessage(message);
            const contextBody = buildMessageContextBody({
                messageText,
                artifactProgram,
                artifactDocument,
                chatId: sessionChatId,
                debugMode: getAgentDebugMode(),
            });

            const sendPromise = sendMessage(message, {
                ...sendOptions,
                body: { ...contextBody, ...sendOptions?.body },
            });

            if (sessionChatId && !hadChatIdAtSend) {
                applyDashboardMintUrlUpdate(router, pathname, searchParams, sessionChatId, {
                    stripSearch: Boolean(search.trim()),
                });
            }

            if (user && firstUserText.trim() && sessionChatId) {
                void ensureChatSessionOnSend({
                    user,
                    chatId: sessionChatId,
                    firstUserText,
                }).then((session) => {
                    if (session.confirmed) {
                        void queryClient.invalidateQueries({ queryKey: ["chat-ids", user.id] });
                        if (session.inserted) {
                            requestGeneratedChatTitle({
                                chatId: session.chatId,
                                userId: user.id,
                                queryClient,
                            });
                        }
                    } else if (!insertFailToastShownForChatIds.current.has(session.chatId)) {
                        insertFailToastShownForChatIds.current.add(session.chatId);
                        toast.warning("Couldn't save this chat yet. Your message will still send.");
                    }
                });
            }

            return sendPromise;
        },
        [
            sendMessage,
            user,
            search,
            router,
            pathname,
            searchParams,
            chatId,
            artifactProgram,
            artifactDocument,
            queryClient,
        ],
    );

    const tryRunSignInMigration = useCallback(async () => {
        if (!user || chatId || migrationAttemptedRef.current) return;

        const isExplicitNewChat = isExplicitNewChatArrival({
            empty: searchParams.get("empty") ?? "",
            urlChatId: searchParams.get("chat") ?? "",
            resume: searchParams.get("resume") ?? "",
        });
        if (isExplicitNewChat) return;

        const thread =
            messages.length > 0 ? messages : readAnonymousChatMessages();
        if (thread.length === 0) return;

        migrationAttemptedRef.current = true;
        const trimmedSearch = search.trim();
        if (trimmedSearch) {
            lastHandledSearchRef.current = trimmedSearch;
        }

        await signInMigrationMutation.mutateAsync(thread);
    }, [user, chatId, messages, search, searchParams, signInMigrationMutation]);

    const trySendInitialPrompt = useCallback(() => {
        if (
            !shouldRunAutoSend(chatEntryPlan, {
                search,
                shareId,
                artifactProgramLength: artifactProgram.length,
                sharedProgramLoadAttempted,
                lastHandledSearch: lastHandledSearchRef.current,
                signInMigrationPending: signInMigrationMutation.isPending,
            })
        ) {
            return;
        }

        const isLongPromptPlaceholder = search === LONG_PROMPT_PLACEHOLDER;
        const messageText = resolveInitialPromptText(search);

        if (!messageText.trim()) return;

        lastHandledSearchRef.current = search.trim();
        clearLongPromptFromSessionStorage(isLongPromptPlaceholder);

        const files = readPendingAttachmentFileParts();

        const payload = files?.length
            ? { text: messageText, files }
            : { text: messageText };

        void sendMessageWithContext(payload);

        const trimmedSearch = search.trim();
        if (trimmedSearch) {
            if (chatId) {
                applyDashboardMintUrlUpdate(router, pathname, searchParams, chatId, {
                    stripSearch: true,
                });
            } else if (!user) {
                stripSearchFromDashboardUrl(router, pathname, searchParams);
            }
        }

        posthog?.capture?.("sent_first_prompt_to_ai", {
            search: messageText.slice(0, 200),
            user: user?.id ?? "user_id_unknown",
        });
    }, [
        chatEntryPlan,
        search,
        shareId,
        chatId,
        user,
        artifactProgram.length,
        sharedProgramLoadAttempted,
        sendMessageWithContext,
        router,
        pathname,
        searchParams,
        signInMigrationMutation.isPending,
    ]);

    const handleSubmit = useCallback(
        (text: string, files?: FileUIPart[]) => {
            if (!text.trim() && (!files || files.length === 0)) return;
            sendMessageWithContext({ text, files });
        },
        [sendMessageWithContext],
    );

    const handleStop = useCallback(() => {
        stop();
        setIsBuilding(false);
    }, [stop]);

    const handleIsBuilding = useCallback((building: boolean) => {
        setIsBuilding(building);
    }, []);

    const handleRetry = useCallback(() => {
        if (retryCount >= MAX_RETRIES) return;

        setGenerationError(null);
        setRetryCount((prev) => prev + 1);
        setIsBuilding(true);
        sendMessageWithContext({ text: "Build my program" });
    }, [retryCount, sendMessageWithContext]);

    const handleClearError = useCallback(() => {
        setGenerationError(null);
        setRetryCount(0);
        setIsBuilding(false);
    }, []);

    const handleTimeoutError = useCallback(() => {
        console.error("Workout generation timed out - no progress for 45 seconds");

        const timeoutError = new Error("Generation timed out. The AI took too long to respond.");
        setGenerationError(timeoutError);
        setIsBuilding(false);
        stop();
        logAgentError(
            timeoutError,
            user?.id,
            resolvePersistChatId(chatId, pendingMintChatIdRef.current),
        );
    }, [stop, user?.id, chatId]);

    const onBuildComplete = useCallback(() => {
        if (!isMobile || hasAutoSwitchedToProgramAfterFirstBuildRef.current) return;

        hasAutoSwitchedToProgramAfterFirstBuildRef.current = true;
        setMobileTab("program");
    }, [isMobile, setMobileTab]);

    const getPersistChatId = useCallback(
        () => resolvePersistChatId(chatId, pendingMintChatIdRef.current),
        [chatId],
    );

    return {
        messages,
        setMessages,
        clearMessages,
        getPersistChatId,
        sendMessageWithContext,
        handleSubmit,
        handleStop,
        isBuilding,
        handleIsBuilding,
        isLoading,
        status,
        activeError,
        onRetry: handleRetry,
        onClearError: handleClearError,
        retryCount,
        maxRetries: MAX_RETRIES,
        onTimeoutError: handleTimeoutError,
        onBuildComplete,
        trySendInitialPrompt,
        tryRunSignInMigration,
        appliedMutateArtifactKeys,
        markMutateArtifactKeysApplied,
    };
}
