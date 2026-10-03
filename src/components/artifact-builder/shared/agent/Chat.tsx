/**
 * @module Chat
 * Chat input for artifact builder: suggestions, upgrade banner, PromptInput or
 * Questionnaire gate footer, with attachments and submit/stop.
 * Upgrade banner: shown for Free users always; for subscribed Pro only when LLM credits are 0 (CTA to Pro+); hidden for Pro+.
 * Mobile dismiss hides the banner until remaining credits hit 0.
 * Depends on: prompt-input, attachments, suggestion, UpgradeBanner, useMyFeatureLimits. Used by: Agent.
 */
/* eslint-disable @next/next/no-img-element */
import {
  PromptInput,
  PromptInputFooter,
  PromptInputProvider,
  PromptInputTextarea,
  PromptInputSubmit,
  usePromptInputAttachments,
  usePromptInputController,
} from "@/components/ai-elements/prompt-input";
import {
  Attachment,
  AttachmentHoverCard,
  AttachmentHoverCardContent,
  AttachmentHoverCardTrigger,
  AttachmentInfo,
  AttachmentPreview,
  AttachmentRemove,
  Attachments,
  getAttachmentLabel,
  getMediaCategory,
} from "@/components/ai-elements/attachments";
import type { TAttachmentData } from "@/components/ai-elements/attachments";
import { Suggestions, Suggestion } from "@/components/ai-elements/suggestion";
import { Mic, Paperclip, Square, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import { UpgradeBanner } from "@/components/ui/upgrade-banner";
import { useMyFeatureLimits } from "@/api/hooks";
import { withRenewsOn } from "@/lib/format-usage-reset-date";
import { useUserContext } from "@/contexts/UserContext";
import { quickTriggerSuggestionChips } from "@/assets/constants/suggestions";
import type { FileUIPart } from "ai";
import { memo, useCallback, forwardRef, useMemo } from "react";
import { useMicTranscription } from "@/hooks/use-mic-transcription";
import { blurChatTabField } from "@/components/artifact-builder/utils/chat-keyboard";
import { Questions } from "@/components/ui/questions";

/** Props for the chat input container. */
interface IProps {
  isLoading: boolean;
  handleSubmit: (text: string, files?: FileUIPart[]) => void;
  handleStop: () => void;
  /** Whether to show quick-trigger suggestion chips (e.g. when no messages). */
  showSuggestions?: boolean;
  isBuilding?: boolean;
  /** Override the default suggestion chip labels (defaults to quickTriggerSuggestionChips). */
  suggestionChips?: string[];
  /** When set, show Questions in place of PromptInput until user completes or skips. */
  questionsPayload?: TQuestionsPayload | null;
  onQuestionsComplete?: (answers: Record<string, string | string[]>) => void;
  onQuestionsSkip?: () => void;
  /** Called when user dismisses the questions without submitting. */
  onQuestionsDismiss?: () => void;
}

interface IAttachmentItemProps {
  attachment: TAttachmentData;
  onRemove: (id: string) => void;
}

const AttachmentItem = memo(({ attachment, onRemove }: IAttachmentItemProps) => {
  const handleRemove = useCallback(
    () => onRemove(attachment.id),
    [onRemove, attachment.id]
  );
  const mediaCategory = getMediaCategory(attachment);
  const label = getAttachmentLabel(attachment);

  return (
    <AttachmentHoverCard>
      <AttachmentHoverCardTrigger asChild>
        <Attachment data={attachment} onRemove={handleRemove}>
          <div className="relative size-5 shrink-0">
            <div className="absolute inset-0 transition-opacity group-hover:opacity-0">
              <AttachmentPreview />
            </div>
            <AttachmentRemove className="absolute inset-0" />
          </div>
          <AttachmentInfo />
        </Attachment>
      </AttachmentHoverCardTrigger>
      <AttachmentHoverCardContent>
        <div className="space-y-3">
          {mediaCategory === "image" &&
            attachment.type === "file" &&
            attachment.url && (
              <div className="flex max-h-96 w-80 items-center justify-center overflow-hidden rounded-md border">
                <img
                  alt={label}
                  className="max-h-full max-w-full object-contain"
                  height={384}
                  src={attachment.url}
                  width={320}
                />
              </div>
            )}
          <div className="space-y-1 px-0.5">
            <h4 className="font-semibold text-sm leading-none">{label}</h4>
            {attachment.mediaType && (
              <p className="font-mono text-muted-foreground text-xs">
                {attachment.mediaType}
              </p>
            )}
          </div>
        </div>
      </AttachmentHoverCardContent>
    </AttachmentHoverCard>
  );
});

AttachmentItem.displayName = "AttachmentItem";

interface IChatInputBodyProps {
  isLoading: boolean;
  outOfCredits: boolean;
  handleStop: () => void;
}

/** Inner input + attachments + submit/stop. Field is always above the
 * buttons so icons never steal horizontal space from the text. */
const ChatInputBody = ({
  isLoading,
  outOfCredits,
  handleStop,
}: IChatInputBodyProps) => {
  const attachments = usePromptInputAttachments();
  const controller = usePromptInputController();
  const composerMirrorText = `${controller.textInput.value || "\u00a0"}\n`;

  const onTranscript = useCallback(
    (text: string) => {
      const prev = controller.textInput.value;
      controller.textInput.setInput(prev.trim() ? `${prev} ${text}` : text);
    },
    [controller.textInput],
  );

  const { status: micStatus, toggle: toggleMic } = useMicTranscription({
    onTranscript,
    disabled: outOfCredits,
  });

  const micDisabled = outOfCredits || micStatus === "transcribing";

  const micTooltip = useMemo(() => {
    if (micStatus === "recording") return "Stop recording";
    if (micStatus === "transcribing") return "Transcribing…";
    return "Use Voice Mode";
  }, [micStatus]);

  const MicIconEl = micStatus === "recording"
    ? Square
    : micStatus === "transcribing"
      ? Loader2
      : Mic;

  const handleRemoveAttachment = useCallback(
    (id: string) => attachments.remove(id),
    [attachments]
  );

  const handlePaperclipClick = () => {
    attachments.openFileDialog();
  };

  return (
    <>
      {attachments.files.length > 0 && (
        <div className="flex w-full shrink-0 justify-start overflow-x-auto overflow-y-hidden pl-4 pt-1 pr-3 pb-2">
          <Attachments variant="inline" className="flex flex-nowrap gap-2 justify-start">
            {attachments.files.map((attachment) => (
              <AttachmentItem
                key={attachment.id}
                attachment={attachment}
                onRemove={handleRemoveAttachment}
              />
            ))}
          </Attachments>
        </div>
      )}
      <div data-align="block-end" className="w-full">
        <div data-proxima-chat-composer-grow="">
          <div
            data-proxima-composer-mirror=""
            aria-hidden
            className="invisible hidden max-sm:block"
          >
            {composerMirrorText}
          </div>
          <PromptInputTextarea
            placeholder="Ask anything…"
            data-proxima-chat-input=""
            className="dark:text-white pl-4 text-base leading-[1.3] sm:text-base md:text-base"
          />
        </div>
        <PromptInputFooter className="mt-2 flex w-full shrink-0 items-end justify-between gap-2 px-3 pb-3 max-sm:mt-1 md:mt-5">
          <div className="flex shrink-0 items-end gap-1">
            <Tooltip>
              <TooltipTrigger asChild>
                <button
                  type="button"
                  onClick={handlePaperclipClick}
                  className="flex size-9 shrink-0 items-center justify-center rounded-full bg-white text-black dark:bg-black dark:text-white hover:bg-white/90"
                  aria-label="Attach files"
                >
                  <Paperclip className="size-4" />
                </button>
              </TooltipTrigger>
              <TooltipContent className="bg-lightSecondary text-white">
                Attach files
              </TooltipContent>
            </Tooltip>
          </div>
          <div className="flex shrink-0 flex-row items-end gap-2">
            <Tooltip>
              <TooltipTrigger asChild>
                <span className="inline-flex">
                  <Button
                    variant="ghost"
                    size="icon"
                    className={cn(
                      "size-9 rounded-full bg-white text-black dark:bg-black dark:text-white hover:bg-white/90 hover:text-white [&_svg]:text-black dark:[&_svg]:text-white disabled:opacity-60",
                      micStatus === "recording" && "bg-red-500 dark:bg-red-500 [&_svg]:text-white dark:[&_svg]:text-white hover:bg-red-600",
                    )}
                    disabled={micDisabled}
                    onClick={toggleMic}
                    aria-label={micTooltip}
                    aria-pressed={micStatus === "recording"}
                  >
                    <MicIconEl size={18} className={cn(micStatus === "transcribing" && "animate-spin")} />
                  </Button>
                </span>
              </TooltipTrigger>
              <TooltipContent className="bg-lightSecondary text-white">
                {micTooltip}
              </TooltipContent>
            </Tooltip>
            <PromptInputSubmit
              status={isLoading ? "streaming" : "ready"}
              onStop={handleStop}
              disabled={outOfCredits}
              className="size-9 rounded-full bg-lightSecondary [&_svg]:text-white"
            />
          </div>
        </PromptInputFooter>
      </div>
    </>
  );
};

/** Chat footer: suggestions, upgrade banner when not pro, and PromptInput or Questions. */
export const Chat = forwardRef<HTMLDivElement, IProps>((props, ref) => {
  const {
    isLoading,
    handleSubmit,
    handleStop,
    showSuggestions = true,
    suggestionChips = quickTriggerSuggestionChips,
    isBuilding,
    questionsPayload,
    onQuestionsComplete,
    onQuestionsSkip,
    onQuestionsDismiss,
  } = props;
  const { user } = useUserContext();
  const { data: featureLimits } = useMyFeatureLimits(user);
  const outOfCredits = featureLimits != null && featureLimits.remaining_llm_requests === 0;
  const isProOnlyTier =
    featureLimits?.has_active_subscription === true && featureLimits.tier === "Pro";
  const showUpgradeBanner =
    featureLimits != null &&
    (!featureLimits.has_active_subscription || (isProOnlyTier && outOfCredits));
  const showQuestions =
    questionsPayload != null && (questionsPayload.questions?.length ?? 0) > 0;

  const submitAndDismissKeyboard = useCallback(
    (text: string, files?: FileUIPart[]) => {
      blurChatTabField();
      handleSubmit(text, files);
    },
    [handleSubmit],
  );

  return (
    <div
      ref={ref}
      data-proxima-chat-composer=""
      className="inset-x-0 bottom-0 mx-auto w-full max-w-3xl shrink-0 px-3 pb-3 md:px-5 md:pb-5 max-sm:fixed max-sm:bottom-[calc(70px+max(0.5rem,env(safe-area-inset-bottom)))] max-sm:left-0 max-sm:right-0 max-sm:px-4 max-sm:bg-background max-sm:dark:bg-extraDarkGray pt-4 max-sm:pt-2"
    >
      <div data-proxima-chat-keyboard-hide="">
        {showSuggestions && !showQuestions ? (
          <Suggestions className="mb-3">
            {suggestionChips.map((label) => (
              <Suggestion
                key={label}
                suggestion={label}
                onClick={submitAndDismissKeyboard}
                className="dark:border-none"
              />
            ))}
          </Suggestions>
        ) : null}
        {showUpgradeBanner ? (
          <UpgradeBanner
            remainingRequests={featureLimits.remaining_llm_requests}
            totalRequests={featureLimits.max_monthly_llm_requests}
            user={user}
            upgradeButtonLabel={
              isProOnlyTier && outOfCredits ? "Upgrade to Pro+" : undefined
            }
            exhaustedMessage={
              outOfCredits
                ? withRenewsOn("You have run out of credits.", featureLimits.resets_on)
                : undefined
            }
            enableMobileDismiss
          />
        ) : null}
      </div>
      <div className="flex w-full">
        {showQuestions ? (
          <div className="min-w-0 flex-1 sm:bg-white bg-extraLightGray dark:bg-darkGray relative z-10 p-0 rounded-md max-sm:pt-0 shadow-2xs overflow-hidden">
            <Questions
              className="w-full min-w-full"
              questions={questionsPayload.questions}
              initialAnswers={questionsPayload.initialAnswers}
              onComplete={onQuestionsComplete}
              onSkip={questionsPayload.allowSkip === false ? undefined : onQuestionsSkip}
              onDismiss={onQuestionsDismiss}
              isBuilding={isBuilding}
              isLoading={isLoading}
              completeAction={questionsPayload.completeAction}
            />
          </div>
        ) : (
          <PromptInputProvider>
            <PromptInput
              onSubmit={({ text, files }) => submitAndDismissKeyboard(text, files)}
              className="min-w-0 flex-1 sm:bg-white bg-extraLightGray dark:bg-darkGray relative z-10 rounded-3xl p-0 pt-1 max-sm:pt-0 shadow-2xs"
            >
              <ChatInputBody
                isLoading={isLoading}
                outOfCredits={outOfCredits}
                handleStop={handleStop}
              />
            </PromptInput>
          </PromptInputProvider>
        )}
      </div>
    </div>
  );
});

Chat.displayName = "Chat";
