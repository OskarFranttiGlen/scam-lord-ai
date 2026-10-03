"use client";

import { memo } from "react";
import type { ChatStatus, FileUIPart } from "ai";
import { Agent } from "@/components/artifact-builder/shared/agent/Agent";
import { Spinner } from "@/components/ui/spinner";
import type { TCommitWithUndoOptions } from "./editor-reducer";
import type { TCommitArtifactWithUndoOptions } from "@/components/artifact-builder/mutations/types";


export interface IProps {
    search: string;
    artifactProgram: TArtifactDay[];
    artifactDocument: TChatArtifactDocument;
    commitWithUndo: (next: TArtifactDay[], options?: TCommitWithUndoOptions) => void;
    commitDocumentWithUndo: (
        next: TChatArtifactDocument,
        options?: TCommitArtifactWithUndoOptions,
    ) => void;
    messages: TChatMessage[];
    setMessages: (
        messages:
            | TChatMessage[]
            | ((msgs: TChatMessage[]) => TChatMessage[]),
    ) => void;
    sendMessageWithContext: Parameters<typeof Agent>[0]["sendMessageWithContext"];
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

    sidebarPosition: "left" | "right";
    onTogglePosition: () => void;
    onToggleExpand: () => void;
    onToggleHide?: () => void;
    isExpanded: boolean;
    /** True while `?chat=` history is loading (avoids empty transcript flash). */
    chatHistoryLoading?: boolean;
}

function DashboardChatPanelInner({
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
    error,
    onRetry,
    onClearError,
    retryCount,
    maxRetries,
    onTimeoutError,
    status,
    handleSubmit,
    handleStop,
    onBuildComplete,
    appliedMutateArtifactKeys,
    markMutateArtifactKeysApplied,
    sidebarPosition,
    onTogglePosition,
    onToggleExpand,
    onToggleHide,
    isExpanded,
    chatHistoryLoading = false,
}: IProps) {
    return (
        <div className="relative flex h-full min-h-0 flex-col">
            {chatHistoryLoading && (
                <div
                    className="absolute inset-0 z-10 flex items-center justify-center bg-background/80"
                    aria-busy="true"
                    aria-label="Loading chat history"
                >
                    <Spinner size="large" />
                </div>
            )}
        <Agent
            search={search}
            artifactProgram={artifactProgram}
            artifactDocument={artifactDocument}
            commitWithUndo={commitWithUndo}
            commitDocumentWithUndo={commitDocumentWithUndo}
            messages={messages}
            setMessages={setMessages}
            sendMessageWithContext={sendMessageWithContext}
            isBuilding={isBuilding}
            handleIsBuilding={handleIsBuilding}
            isLoading={isLoading}
            error={error}
            onRetry={onRetry}
            onClearError={onClearError}
            retryCount={retryCount}
            maxRetries={maxRetries}
            onTimeoutError={onTimeoutError}
            status={status}
            handleSubmit={handleSubmit}
            handleStop={handleStop}
            onBuildComplete={onBuildComplete}
            appliedMutateArtifactKeys={appliedMutateArtifactKeys}
            markMutateArtifactKeysApplied={markMutateArtifactKeysApplied}
            sidebarPosition={sidebarPosition}
            onTogglePosition={onTogglePosition}
            onToggleExpand={onToggleExpand}
            onToggleHide={onToggleHide}
            isExpanded={isExpanded}
        />
        </div>
    );
}

export const DashboardChatPanel = memo(DashboardChatPanelInner);
