import { cn } from "@/lib/utils";

const WORDMARK_PX = {
    xl: 56,
    lg: 56,
    header: 32,
    sm: 26,
    nav: 20,
} as const;

export type TLogoGround = "mint" | "inverse" | "surface";
export type TLogoSize = keyof typeof WORDMARK_PX;

export interface ILogoProps {
    ground?: TLogoGround;
    size?: TLogoSize;
    showMark?: boolean;
    showWordmark?: boolean;
    className?: string;
    wordmarkClassName?: string;
}

/**
 * Mark + live-type wordmark.
 */
export function Logo({
    ground = "surface",
    size = "header",
    showMark = true,
    showWordmark = true,
    className,
    wordmarkClassName,
}: ILogoProps) {
    const wordmarkPx = WORDMARK_PX[size];
    const markPx = Math.round(wordmarkPx * 1.8);
    const markSrc = ground === "inverse" ? "/mark-reversed.svg" : "/mark.svg";
    const reversedMarkSrc = "/mark-reversed.svg";
    const ink = ground === "mint"
        ? "text-brand-ink"
        : ground === "inverse"
            ? "text-brand-mint"
            : "text-brand-ink dark:text-brand-mint";

    return (
        <div className={cn("flex items-center gap-4", ink, className)}>
            {!showMark ? null : ground === "surface" ? (
                <>
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                        src={markSrc}
                        alt=""
                        width={markPx}
                        height={markPx}
                        className="dark:hidden shrink-0"
                    />
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                        src={reversedMarkSrc}
                        alt=""
                        width={markPx}
                        height={markPx}
                        className="hidden dark:block shrink-0"
                    />
                </>
            ) : (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                    src={markSrc}
                    alt={showWordmark ? "" : "RentRecovery"}
                    width={markPx}
                    height={markPx}
                    className="shrink-0"
                />
            )}
            {showWordmark ? (
                <div className={cn("min-w-0", wordmarkClassName)}>
                    <p
                        className="font-main leading-none"
                        style={{ fontSize: wordmarkPx, letterSpacing: size === "xl" ? "-2px" : size === "lg" ? "-1px" : undefined }}
                    >
                        RentRecovery
                    </p>
                </div>
            ) : null}
        </div>
    );
}
