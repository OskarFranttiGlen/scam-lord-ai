"use client";

/**
 * @module (app)/(with-toolbar)/dashboard/DashboardClient
 *
 * Builder shell: chat + artifact grid. Local document + undo remain for the
 * dual-pane template loop (ADR 0034 / 04).
 *
 * Depends on: useChat, UserContext, resizable panels, ProgramEditor.
 * Used by: dashboard/page.tsx.
 */

import { useState, useEffect, useMemo, useReducer, useCallback, useRef, type RefObject } from "react";
import { useIsMobile } from "@/hooks/use-mobile";
import type { ImperativePanelHandle } from "react-resizable-panels";

import { DashboardDesktopLayout } from "./DashboardDesktopLayout";
import { DashboardMobileLayout } from "./DashboardMobileLayout";
import { DashboardChatPanel } from "./DashboardChatPanel";
import { MessageSquare } from "lucide-react";

import { useSearchParams, useRouter } from "next/navigation";
import { ProgramEditor } from "./ProgramEditor";
import { documentHasArtifactItems } from "@/components/artifact-builder/day-card/document-grid";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { CHAT_MESSAGES_KEY, COLLAPSED_SIZE, EXPANDED_SIZE, SIDEBAR_POSITION_KEY, SIDEBAR_SIZE_KEY } from "@/assets/constants/ui-constants";
import { useDebouncedCallback } from "use-debounce";
import { useUserContext } from "@/contexts/UserContext";
import { buildAuthLoginHref } from "@/lib/sign-in-return";
import { buildDashboardHref } from "@/lib/dashboard-url";
import { useDashboardActions } from "@/contexts/DashboardActionsContext";
import { isChatSessionInsertConfirmed } from "@/api/chat-history";
import { ToolbarPortalButtons } from "@/components/artifact-builder/shared/ToolbarPortalButtons";
import { DashboardToolbarTitle } from "@/components/artifact-builder/shared/DashboardToolbarTitle";
import {
    canWriteBuilderDraft,
    enableBuilderDraftWrites,
} from "@/lib/builder-draft";
import { ArtifactMutationProvider } from "@/contexts/ArtifactMutationContext";
import type { TCommitArtifactWithUndoOptions } from "@/components/artifact-builder/mutations";
import { isArtifactMutationLockActive } from "@/components/artifact-builder/utils/mutation-proposal";
import {
    createInitialEditorState,
    editorReducer,
    isNewPathDirty,
} from "./editor-reducer";
import type { TCommitWithUndoOptions } from "./editor-reducer";
import { readAnonymousChatMessages, useDashboardChat } from "./use-dashboard-chat";
import {
    advanceChatNavigationLatch,
    buildShellKey,
    createChatNavigationLatch,
    resetChatNavigationLatchForArrival,
    isBareDashboardArrival,
    isExplicitNewChatArrival,
    parseDashboardArrival,
    shouldRedirectBareDashboardToEmpty,
    resolveChatEntryPlan,
    resolveInitialMessages,
    resolveChatHistoryFetchEnabled,
    resolveSendPathConfirmed,
    resolveSidebarRowKnown,
    type IChatEntryPlan,
    type IChatNavigationLatch,
} from "./resolve-chat-entry";
import type { User } from "@supabase/supabase-js";
import { useChatHistory, useChatIds } from "@/api/hooks";
import posthog from "posthog-js";

/** Builder route path — was `@/lib/dashboard-url` (deleted). */
const DASHBOARD_PATH = "/dashboard";

/** Logged-in only; module guard avoids duplicate capture under Strict Mode remount. */
let buildProgramPageViewSent = false;

function logPageView(userId: string | undefined): void {
    if (!userId || buildProgramPageViewSent) return;
    buildProgramPageViewSent = true;
    posthog?.capture?.("page_view", { page: "/dashboard", user: userId });
}

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

/** Identity hydrate — full key assign lived in deleted helpers. */
function normalizeProgramState(program: TArtifactDay[]): TArtifactDay[] {
    return program;
}

function readSidebarPosition(): "left" | "right" {
    if (typeof window === "undefined") return "left";
    const saved = localStorage.getItem(SIDEBAR_POSITION_KEY);
    return saved === "left" || saved === "right" ? saved : "left";
}

function readSidebarSize(): number {
    if (typeof window === "undefined") return 28;
    const saved = localStorage.getItem(SIDEBAR_SIZE_KEY);
    if (!saved) return 28;
    const size = parseFloat(saved);
    return size >= 20 && size <= EXPANDED_SIZE ? size : 28;
}

function chatNavigationLatchEquals(a: IChatNavigationLatch, b: IChatNavigationLatch): boolean {
    return (
        a.latched === b.latched
        && a.prevChatId === b.prevChatId
        && (a.pendingSidebarPick ?? false) === (b.pendingSidebarPick ?? false)
    );
}

/**
 * Program builder client: chat sidebar, local artifact grid, URL chat params.
 * No props; reads searchParams and context.
 */
export function Dashboard() {
    const { user, isLoading: isAuthLoading } = useUserContext();
    const router = useRouter();
    logPageView(user?.id);
    const searchParams = useSearchParams();
    const persistSignInHref = !isAuthLoading && !user
        ? buildAuthLoginHref(DASHBOARD_PATH, searchParams)
        : null;

    const arrival = parseDashboardArrival(searchParams);
    const { urlChatId, search, shareId, empty, resume } = arrival;
    const chatId = urlChatId;

    const isBareArrival = isBareDashboardArrival({ urlChatId, search, shareId, empty, resume });
    const explicitNewChat = isExplicitNewChatArrival({ empty, urlChatId, resume });

    const [sawNonBareArrival, setSawNonBareArrival] = useState(!isBareArrival);
    if (!isBareArrival && !sawNonBareArrival) {
        setSawNonBareArrival(true);
    }
    const shouldBareRedirectToEmpty = shouldRedirectBareDashboardToEmpty(
        isBareArrival,
        sawNonBareArrival,
    );

    const { data: chatIds } = useChatIds(user);
    const sidebarRowKnown = resolveSidebarRowKnown(chatId, chatIds);
    const sendPathConfirmed = resolveSendPathConfirmed(chatId, isChatSessionInsertConfirmed(chatId));

    const [chatNavLatch, setChatNavLatch] = useState(() => createChatNavigationLatch(urlChatId));
    const resetLatch = resetChatNavigationLatchForArrival(
        { empty, urlChatId, resume },
        chatNavLatch,
    );
    const { chatNavigationArrival, next: chatNavLatchNext } = advanceChatNavigationLatch(
        chatId,
        resetLatch,
        { sidebarRowKnown, sendPathConfirmed, hasEmptyParam: empty === "true" },
    );
    if (!chatNavigationLatchEquals(chatNavLatch, chatNavLatchNext)) {
        setChatNavLatch(chatNavLatchNext);
    }
    const programHydrateChatId = chatNavigationArrival ? chatId : "";

    /** Share/program hydrate removed — never block chat on a shared load. */
    const sharedProgramLoadAttempted = true;

    const [{ artifactProgram, artifactDocument, undoStack, proposalMarks }, dispatchEditor] =
        useReducer(editorReducer, undefined, () => createInitialEditorState());
    const hasProgramContent = documentHasArtifactItems(artifactDocument);

    const setProgramFromHydrate = useCallback((program: TArtifactDay[]) => {
        dispatchEditor({ type: "REPLACE_PROGRAM", program: normalizeProgramState(program) });
    }, [dispatchEditor]);

    const setDocumentFromHydrate = useCallback((document: TChatArtifactDocument) => {
        dispatchEditor({
            type: "REPLACE_PROGRAM",
            program: [],
            document,
        });
    }, [dispatchEditor]);

    const commitWithUndo = useCallback((next: TArtifactDay[], options?: TCommitWithUndoOptions) => {
        enableBuilderDraftWrites();
        dispatchEditor({
            type: "COMMIT_PROGRAM",
            program: normalizeProgramState(next),
            recordUndo: options?.recordUndo ?? true,
            proposalMarkKeys: options?.proposalMarkKeys,
        });
    }, [dispatchEditor]);

    const commitDocumentWithUndo = useCallback((
        next: TChatArtifactDocument,
        options?: TCommitArtifactWithUndoOptions,
    ) => {
        enableBuilderDraftWrites();
        dispatchEditor({
            type: "COMMIT_DOCUMENT",
            document: next,
            recordUndo: options?.recordUndo ?? true,
            proposalMarkKeys: options?.proposalMarkKeys,
        });
    }, [dispatchEditor]);

    const programResetKey = `${programHydrateChatId}|${shareId}|${resume}|${empty}`;
    const [appliedProgramResetKey, setAppliedProgramResetKey] = useState(programResetKey);
    if (appliedProgramResetKey !== programResetKey) {
        setAppliedProgramResetKey(programResetKey);
        setProgramFromHydrate([]);
    }
    const chatHistoryFetchEnabled = resolveChatHistoryFetchEnabled({
        user,
        chatId,
        sidebarRowKnown,
        sendPathConfirmed,
        chatNavigationArrival,
    });

    const {
        data: chatHistoryData,
        isPending: chatHistoryPending,
        isSuccess: chatHistorySuccess,
    } = useChatHistory(user, chatId, { enabled: chatHistoryFetchEnabled });

    const chatEntryPlan = useMemo(
        () =>
            resolveChatEntryPlan({
                user,
                chatId,
                search,
                shareId,
                sidebarRowKnown,
                sendPathConfirmed,
                chatNavigationArrival,
                sharedProgramLoadAttempted,
                artifactProgramLength: artifactProgram.length,
                chatHistorySuccess,
                anonLocalMessageCount: readAnonymousChatMessages().length,
                explicitNewChat,
            }),
        [
            user,
            chatId,
            search,
            shareId,
            sidebarRowKnown,
            sendPathConfirmed,
            chatNavigationArrival,
            sharedProgramLoadAttempted,
            artifactProgram.length,
            chatHistorySuccess,
            explicitNewChat,
        ],
    );

    const chatHistoryLoading = Boolean(chatId && user && chatEntryPlan.enableHistoryFetch && chatHistoryPending);

    const shellKey = buildShellKey(chatEntryPlan, {
        chatId,
        user,
        chatHistorySuccess,
        chatNavigationArrival,
    });

    const chatInitialMessages = useMemo(
        () =>
            resolveInitialMessages(chatEntryPlan, {
                chatHistoryData,
                anonymousMessages: readAnonymousChatMessages(),
            }),
        [chatEntryPlan, chatHistoryData],
    );

    const [sidebarPosition, setSidebarPosition] = useState(readSidebarPosition);
    const [sidebarSize, setSidebarSize] = useState(readSidebarSize);
    const sidebarPanelRef = useRef<ImperativePanelHandle>(null);
    const lastSidebarSizeRef = useRef(28);
    const saveSidebarSize = useDebouncedCallback((size: number) => {
        localStorage.setItem(SIDEBAR_SIZE_KEY, size.toString());
    }, 200);
    const [isChatHidden, setIsChatHidden] = useState(false);
    const [mobileTab, setMobileTab] = useState<string>("chat");

    const isMobile = useIsMobile();

    const handleUndo = useCallback(() => {
        enableBuilderDraftWrites();
        dispatchEditor({ type: "UNDO" });
    }, [dispatchEditor]);

    useEffect(() => {
        if (shouldBareRedirectToEmpty) {
            router.replace(buildDashboardHref({ empty: true }));
        }
    }, [shouldBareRedirectToEmpty, router]);

    const toggleSidebarPosition = useCallback(() => {
        setSidebarPosition((prev) => {
            const newPosition = prev === "left" ? "right" : "left";
            localStorage.setItem(SIDEBAR_POSITION_KEY, newPosition);
            return newPosition;
        });
    }, []);

    const onToggleExpand = useCallback(() => {
        const panel = sidebarPanelRef.current;
        if (!panel) return;
        const current = panel.getSize();
        if (current <= COLLAPSED_SIZE + 5) {
            panel.resize(EXPANDED_SIZE);
        } else {
            panel.resize(COLLAPSED_SIZE);
        }
    }, []);

    const handleToggleHide = useCallback(() => {
        sidebarPanelRef.current?.collapse();
        setIsChatHidden(true);
    }, []);

    const handleOpenChat = useCallback(() => {
        const panel = sidebarPanelRef.current;
        if (panel) {
            panel.expand();
            panel.resize(lastSidebarSizeRef.current || 28);
        }
        setIsChatHidden(false);
    }, []);

    const onSidebarResize = useCallback(
        (size: number) => {
            setSidebarSize(size);
            saveSidebarSize(size);
            setIsChatHidden(size < 1);
            if (size >= 1) lastSidebarSizeRef.current = size;
        },
        [saveSidebarSize],
    );

    const isExpanded = sidebarSize >= EXPANDED_SIZE - 5;

    return (
        <DashboardShell
            key={shellKey}
            chatHistoryLoading={chatHistoryLoading}
            initialMessages={chatInitialMessages}
            user={user}
            isAuthLoading={isAuthLoading}
            persistSignInHref={persistSignInHref}
            chatId={chatId}
            search={search}
            artifactProgram={artifactProgram}
            artifactDocument={artifactDocument}
            commitWithUndo={commitWithUndo}
            commitDocumentWithUndo={commitDocumentWithUndo}
            setDocumentFromHydrate={setDocumentFromHydrate}
            proposalMarkKeys={proposalMarks?.keys ?? []}
            isMobile={isMobile}
            sharedProgramLoadAttempted={sharedProgramLoadAttempted}
            undoStackLength={undoStack.length}
            handleUndo={handleUndo}
            sidebarPosition={sidebarPosition}
            toggleSidebarPosition={toggleSidebarPosition}
            onToggleExpand={onToggleExpand}
            handleToggleHide={handleToggleHide}
            handleOpenChat={handleOpenChat}
            isExpanded={isExpanded}
            sidebarPanelRef={sidebarPanelRef}
            sidebarSize={sidebarSize}
            onSidebarResize={onSidebarResize}
            isChatHidden={isChatHidden}
            mobileTab={mobileTab}
            setMobileTab={setMobileTab}
            chatEntryPlan={chatEntryPlan}
            hasProgramContent={hasProgramContent}
        />
    );
}

interface IDashboardShellProps {
    chatHistoryLoading: boolean;
    initialMessages: TChatMessage[];
    user: User | null;
    isAuthLoading: boolean;
    persistSignInHref: string | null;
    chatId: string;
    search: string;
    artifactProgram: TArtifactDay[];
    artifactDocument: TChatArtifactDocument;
    commitWithUndo: (next: TArtifactDay[], options?: TCommitWithUndoOptions) => void;
    commitDocumentWithUndo: (
        next: TChatArtifactDocument,
        options?: TCommitArtifactWithUndoOptions,
    ) => void;
    setDocumentFromHydrate: (document: TChatArtifactDocument) => void;
    proposalMarkKeys: readonly number[];
    isMobile: boolean;
    sharedProgramLoadAttempted: boolean;
    undoStackLength: number;
    handleUndo: () => void;
    sidebarPosition: "left" | "right";
    toggleSidebarPosition: () => void;
    onToggleExpand: () => void;
    handleToggleHide: () => void;
    handleOpenChat: () => void;
    isExpanded: boolean;
    sidebarPanelRef: RefObject<ImperativePanelHandle | null>;
    sidebarSize: number;
    onSidebarResize: (size: number) => void;
    isChatHidden: boolean;
    mobileTab: string;
    setMobileTab: (tab: string) => void;
    chatEntryPlan: IChatEntryPlan;
    hasProgramContent: boolean;
}

function DashboardShell({
    chatHistoryLoading,
    initialMessages,
    user,
    isAuthLoading,
    persistSignInHref,
    chatId,
    search,
    artifactProgram,
    artifactDocument,
    commitWithUndo,
    commitDocumentWithUndo,
    setDocumentFromHydrate,
    proposalMarkKeys,
    isMobile,
    sharedProgramLoadAttempted,
    undoStackLength,
    handleUndo,
    sidebarPosition,
    toggleSidebarPosition,
    onToggleExpand,
    handleToggleHide,
    handleOpenChat,
    isExpanded,
    sidebarPanelRef,
    sidebarSize,
    onSidebarResize,
    isChatHidden,
    mobileTab,
    setMobileTab,
    chatEntryPlan,
    hasProgramContent,
}: IDashboardShellProps) {
    const { clearChatRef, getPersistChatIdRef } = useDashboardActions();

    const chat = useDashboardChat({
        user,
        artifactProgram,
        artifactDocument,
        isMobile,
        setMobileTab,
        initialMessages,
        sharedProgramLoadAttempted,
        chatId,
        chatEntryPlan,
    });

    const {
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
    } = chat;

    useEffect(() => {
        clearChatRef.current = clearMessages;
        getPersistChatIdRef.current = getPersistChatId;
    }, [clearChatRef, getPersistChatIdRef, clearMessages, getPersistChatId]);

    const agentMutationLock = isArtifactMutationLockActive(
        messages,
        status,
        artifactDocument,
        appliedMutateArtifactKeys,
    );

    const onUndo = useCallback(() => {
        if (agentMutationLock) return;
        handleUndo();
    }, [agentMutationLock, handleUndo]);

    useEffect(() => {
        void (async () => {
            await tryRunSignInMigration();
            trySendInitialPrompt();
        })();
    }, [tryRunSignInMigration, trySendInitialPrompt, sharedProgramLoadAttempted]);

    const localStorageDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const DEBOUNCE_MS = 500;

    useEffect(() => {
        if (typeof window === "undefined") return;

        if (localStorageDebounceRef.current) {
            clearTimeout(localStorageDebounceRef.current);
            localStorageDebounceRef.current = null;
        }

        localStorageDebounceRef.current = setTimeout(() => {
            localStorageDebounceRef.current = null;
            if (!canWriteBuilderDraft()) return;
            const firstUser = messages.find((m) => m.role === "user");
            const promptToStore = (search && search.trim()) || (firstUser ? getMessageText(firstUser) : "");
            localStorage.setItem("prompt", JSON.stringify(promptToStore));

            if (!user && messages.length > 0) {
                localStorage.setItem(CHAT_MESSAGES_KEY, JSON.stringify(messages));
            }
        }, DEBOUNCE_MS);

        return () => {
            if (localStorageDebounceRef.current) {
                clearTimeout(localStorageDebounceRef.current);
                localStorageDebounceRef.current = null;
            }
        };
    }, [search, user, messages]);

    const chatPanelStateProps = {
        search,
        artifactProgram,
        artifactDocument,
        commitWithUndo,
        commitDocumentWithUndo,
        messages,
        setMessages,
        sendMessageWithContext,
        isBuilding,
        handleIsBuilding,
        isLoading,
        error: activeError,
        onRetry: handleRetry,
        onClearError: handleClearError,
        retryCount,
        maxRetries: MAX_RETRIES,
        onTimeoutError: handleTimeoutError,
        status,
        handleSubmit,
        handleStop,
        onBuildComplete,
        appliedMutateArtifactKeys,
        markMutateArtifactKeysApplied,
        chatHistoryLoading,
    } as const;

    const desktopChatPanel = (
        <DashboardChatPanel
            {...chatPanelStateProps}
            sidebarPosition={sidebarPosition}
            onTogglePosition={toggleSidebarPosition}
            onToggleExpand={onToggleExpand}
            onToggleHide={handleToggleHide}
            isExpanded={isExpanded}
        />
    );

    const mobileChatPanel = (
        <DashboardChatPanel
            {...chatPanelStateProps}
            sidebarPosition="left"
            onTogglePosition={() => {}}
            onToggleExpand={() => {}}
            onToggleHide={handleToggleHide}
            isExpanded={false}
        />
    );

    const routineContent = (
        <ProgramEditor document={artifactDocument} isMobile={isMobile} />
    );

    return (
        <ArtifactMutationProvider
            document={artifactDocument}
            commitWithUndo={commitDocumentWithUndo}
            setDocumentFromHydrate={setDocumentFromHydrate}
            isAgentStreaming={agentMutationLock}
            proposalMarkKeys={proposalMarkKeys}
        >
            <DashboardToolbarTitle
                value={"Default Title"}
                onChange={() => {}}
            />
            <ToolbarPortalButtons
                canUndo={isNewPathDirty(undoStackLength)}
                undoDisabled={agentMutationLock}
                onUndo={onUndo}
                onSave={() => {}}
                saveDisabled
                isSaving={false}
                persistMode="save"
                signInHref={persistSignInHref}
                isAuthLoading={isAuthLoading}
                startHref={null}
            />
            {isChatHidden && (
                <TooltipProvider delayDuration={0}>
                    <Tooltip>
                        <TooltipTrigger asChild>
                            <Button
                                variant="outline"
                                size="sm"
                                onClick={handleOpenChat}
                                className="fixed top-31 z-40 max-sm:hidden gap-2 rounded-l-none rounded-r-full px-4 py-2 shadow-md bg-white dark:bg-extraDarkGray border-gray-300 dark:border-gray-600"
                                aria-label="Open chat"
                            >
                                <MessageSquare className="h-4 w-4" />
                            </Button>
                        </TooltipTrigger>
                        <TooltipContent className="bg-lightSecondary text-white">Open chat</TooltipContent>
                    </Tooltip>
                </TooltipProvider>
            )}
            <DashboardDesktopLayout
                sidebarPosition={sidebarPosition}
                sidebarPanelRef={sidebarPanelRef}
                sidebarSize={sidebarSize}
                onSidebarResize={onSidebarResize}
                isChatHidden={isChatHidden}
                chatPanel={desktopChatPanel}
                routineContent={routineContent}
                maxSidebarSize={EXPANDED_SIZE}
            />
            <DashboardMobileLayout
                mobileTab={mobileTab}
                onMobileTabChange={setMobileTab}
                hasProgramContent={hasProgramContent}
                chatPanel={mobileChatPanel}
                routineContent={routineContent}
            />
        </ArtifactMutationProvider>
    );
}
