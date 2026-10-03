"use client";

/**
 * @module questions
 * Multi-step Questionnaire gate footer (select + text-with-quickfill).
 * Domain-neutral stubs (ADR 0034 / C10) — no training-profile height helpers.
 *
 * Depends on: @/lib/utils, UI button/input
 * Used by: artifact-builder Chat footer
 */

import * as React from "react";
import { Loader2, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

interface IQuestionsProps {
    questions: TQuestion[];
    onComplete?: (answers: Record<string, string | string[]>) => void;
    onSkip?: () => void;
    onDismiss?: () => void;
    className?: string;
    isBuilding?: boolean;
    isLoading?: boolean;
    initialAnswers?: Record<string, string | string[]>;
    completeAction?: "continue";
}

interface IQuestionSelectProps {
    question: TQuestion;
    selectedAnswer: string | undefined;
    otherText: string;
    onSelect: (questionId: string, optionId: string) => void;
    onOtherSelect: (questionId: string) => void;
    onOtherTextChange: (questionId: string, text: string) => void;
    letterKeys: string[];
    questionIndex: number;
}

function QuestionSelect({
    question,
    selectedAnswer,
    otherText,
    onSelect,
    onOtherSelect,
    onOtherTextChange,
    letterKeys,
    questionIndex,
}: IQuestionSelectProps) {
    const isOtherSelected = selectedAnswer?.startsWith("other:");

    return (
        <>
            <p className="mb-3 text-sm font-semibold">
                {questionIndex + 1}. {question.question}
            </p>
            <div className="flex flex-col gap-1">
                {question.options.map((option, optionIndex) => {
                    const isSelected = selectedAnswer === option.id;
                    return (
                        <button
                            key={option.id}
                            type="button"
                            onClick={() => onSelect(question.id, option.id)}
                            className={cn(
                                "flex items-center gap-3 rounded-md px-2 py-1.5 text-left text-sm transition-colors",
                                "hover:bg-accent",
                                isSelected && "bg-accent",
                            )}
                            aria-label={`Select ${option.label}`}
                        >
                            <span
                                className={cn(
                                    "flex size-5 shrink-0 items-center justify-center rounded text-xs font-medium",
                                    "bg-muted text-muted-foreground",
                                    isSelected && "bg-lightSecondary text-white",
                                )}
                            >
                                {letterKeys[optionIndex]}
                            </span>
                            <span className="text-foreground">{option.label}</span>
                        </button>
                    );
                })}
                {question.allowOther ? (
                    <div className="mt-1">
                        <button
                            type="button"
                            onClick={() => onOtherSelect(question.id)}
                            className={cn(
                                "flex w-full items-center gap-3 rounded-md px-2 py-1.5 text-left text-sm transition-colors",
                                "hover:bg-accent",
                                isOtherSelected && "bg-accent",
                            )}
                            aria-label="Select other"
                        >
                            <span
                                className={cn(
                                    "flex size-5 shrink-0 items-center justify-center rounded text-xs font-medium",
                                    "bg-muted text-muted-foreground",
                                    isOtherSelected && "bg-lightSecondary text-white",
                                )}
                            >
                                {letterKeys[question.options.length] ?? "?"}
                            </span>
                            <span className="text-foreground">Other</span>
                        </button>
                        {isOtherSelected ? (
                            <Input
                                value={otherText}
                                onChange={(event) =>
                                    onOtherTextChange(question.id, event.target.value)
                                }
                                placeholder="Type your answer"
                                className="mt-2"
                                aria-label={`Other answer for ${question.question}`}
                            />
                        ) : null}
                    </div>
                ) : null}
            </div>
        </>
    );
}

interface IQuestionTextProps {
    question: TQuestion;
    value: string;
    onChange: (questionId: string, text: string) => void;
    onChip: (questionId: string, optionId: string) => void;
    questionIndex: number;
}

function QuestionTextWithQuickfill({
    question,
    value,
    onChange,
    onChip,
    questionIndex,
}: IQuestionTextProps) {
    return (
        <>
            <p className="mb-3 text-sm font-semibold">
                {questionIndex + 1}. {question.question}
            </p>
            <Input
                value={value}
                onChange={(event) => onChange(question.id, event.target.value)}
                placeholder="Type your answer"
                aria-label={question.question}
            />
            {question.options.length > 0 ? (
                <div className="mt-2 flex flex-wrap gap-1.5">
                    {question.options.map((option) => (
                        <button
                            key={option.id}
                            type="button"
                            onClick={() => onChip(question.id, option.label)}
                            className={cn(
                                "rounded-md border px-2 py-1 text-xs transition-colors",
                                "hover:bg-accent",
                                value === option.label && "bg-accent",
                            )}
                        >
                            {option.label}
                        </button>
                    ))}
                </div>
            ) : null}
        </>
    );
}

/**
 * Renders the Questionnaire gate question list and submit/skip/dismiss actions.
 *
 * @param props.questions - App-owned question subset from getMoreInfoQuestions
 * @param props.onComplete - Called with answers map (questionId → value)
 */
export function Questions({
    questions,
    onComplete,
    onSkip,
    onDismiss,
    isBuilding,
    isLoading,
    className,
    initialAnswers,
}: IQuestionsProps) {
    const [answers, setAnswers] = React.useState<Record<string, string | string[]>>(
        initialAnswers ?? {},
    );
    const [otherTexts, setOtherTexts] = React.useState<Record<string, string>>({});
    const letterKeys = [
        "A", "B", "C", "D", "E", "F", "G", "H", "I", "J", "K", "L", "M",
        "N", "O", "P", "Q", "R", "S", "T", "U", "V", "W", "X", "Y", "Z",
    ];
    const busy = Boolean(isBuilding || isLoading);

    const handleOptionSelect = (questionId: string, optionId: string) => {
        setAnswers((prev) => {
            if (prev[questionId] === optionId) {
                const { [questionId]: _, ...rest } = prev;
                return rest;
            }
            return { ...prev, [questionId]: optionId };
        });
    };

    const handleOtherSelect = (questionId: string) => {
        setAnswers((prev) => {
            const current = prev[questionId];
            if (typeof current === "string" && current.startsWith("other:")) {
                const { [questionId]: _, ...rest } = prev;
                return rest;
            }
            return { ...prev, [questionId]: `other:${otherTexts[questionId] || ""}` };
        });
    };

    const handleOtherTextChange = (questionId: string, text: string) => {
        setOtherTexts((prev) => ({ ...prev, [questionId]: text }));
        setAnswers((prev) => ({ ...prev, [questionId]: `other:${text}` }));
    };

    const handleTextChange = (questionId: string, text: string) => {
        setAnswers((prev) => {
            if (!text) {
                const { [questionId]: _, ...rest } = prev;
                return rest;
            }
            return { ...prev, [questionId]: text };
        });
    };

    const handleChip = (questionId: string, label: string) => {
        setAnswers((prev) => ({ ...prev, [questionId]: label }));
    };

    const handleComplete = () => {
        onComplete?.(answers);
    };

    return (
        <div
            className={cn(
                "flex max-h-[min(60vh,28rem)] flex-col gap-4 overflow-y-auto p-3 sm:p-4",
                className,
            )}
        >
            <div className="flex items-start justify-between gap-2">
                <p className="text-sm font-medium text-foreground">A few quick questions</p>
                {onDismiss ? (
                    <button
                        type="button"
                        onClick={onDismiss}
                        disabled={busy}
                        className="rounded-md p-1 text-muted-foreground hover:bg-accent hover:text-foreground"
                        aria-label="Dismiss questionnaire"
                    >
                        <X className="size-4" />
                    </button>
                ) : null}
            </div>
            <div className="flex flex-col gap-6">
                {questions.map((question, index) => {
                    const type = question.type ?? "select";
                    const raw = answers[question.id];
                    const selected =
                        typeof raw === "string" ? raw : undefined;
                    return (
                        <div key={question.id}>
                            {type === "text-with-quickfill" ? (
                                <QuestionTextWithQuickfill
                                    question={question}
                                    value={selected ?? ""}
                                    onChange={handleTextChange}
                                    onChip={handleChip}
                                    questionIndex={index}
                                />
                            ) : (
                                <QuestionSelect
                                    question={question}
                                    selectedAnswer={selected}
                                    otherText={otherTexts[question.id] ?? ""}
                                    onSelect={handleOptionSelect}
                                    onOtherSelect={handleOtherSelect}
                                    onOtherTextChange={handleOtherTextChange}
                                    letterKeys={letterKeys}
                                    questionIndex={index}
                                />
                            )}
                        </div>
                    );
                })}
            </div>
            <div className="flex flex-wrap items-center justify-end gap-2 pt-1">
                {onSkip ? (
                    <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        disabled={busy}
                        onClick={onSkip}
                    >
                        Skip
                    </Button>
                ) : null}
                <Button
                    type="button"
                    size="sm"
                    disabled={busy}
                    onClick={handleComplete}
                    className="bg-lightSecondary text-white hover:bg-lightSecondary/90"
                >
                    {busy ? <Loader2 className="size-4 animate-spin" /> : "Continue"}
                </Button>
            </div>
        </div>
    );
}
