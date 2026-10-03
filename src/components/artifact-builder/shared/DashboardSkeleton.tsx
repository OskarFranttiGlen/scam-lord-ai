/**
 * @module DashboardSkeleton
 * Client-side loading skeleton for the program builder (steps + quote placeholders). Shown while dashboard content loads.
 * Depends on: Skeleton, coolQuotes. Used by: dashboard page (client).
 */
import { Skeleton } from "@/components/ui/skeleton";
import { FC } from "react";

/** Full-width skeleton matching builder layout (step strips + large quote cells). */
export const DashboardSkeleton: FC = () => {

    return (
        <>
            <div className="py-4 rounded-lg flex flex-row flex-nowrap gap-2">
                <div className="min-w-[440px] max-w-[440px] h-[40px]">
                    <Skeleton className="rounded-xl h-full w-full" />
                </div>
                <div className="min-w-[440px] max-w-[440px] h-[40px]">
                    <Skeleton className="rounded-xl h-full w-full" />
                </div>
                <div className="min-w-[440px] max-w-[440px] h-[40px]">
                    <Skeleton className="rounded-xl h-full w-full" />
                </div>
                <div className="min-w-[440px] max-w-[440px] h-[40px]">
                    <Skeleton className="rounded-xl h-full w-full" />
                </div>
                <div className="min-w-[440px] max-w-[440px] h-[40px]">
                    <Skeleton className="rounded-xl h-full w-full" />
                </div>
                <div className="min-w-[440px] max-w-[440px] h-[40px]">
                    <Skeleton className="rounded-xl h-full w-full" />
                </div>
            </div>

            <div className="pb-4 rounded-lg flex flex-row flex-nowrap gap-2">
                <div className="min-w-[440px] max-w-[440px] h-[40px]">
                    <Skeleton className="rounded-xl h-full w-full" />
                </div>
                <div className="min-w-[440px] max-w-[440px] h-[40px]">
                    <Skeleton className="rounded-xl h-full w-full" />
                </div>
                <div className="min-w-[440px] max-w-[440px] h-[40px]">
                    <Skeleton className="rounded-xl h-full w-full" />
                </div>
                <div className="min-w-[440px] max-w-[440px] h-[40px]">
                    <Skeleton className="rounded-xl h-full w-full" />
                </div>
                <div className="min-w-[440px] max-w-[440px] h-[40px]">
                    <Skeleton className="rounded-xl h-full w-full" />
                </div>
                <div className="min-w-[440px] max-w-[440px] h-[40px]">
                    <Skeleton className="rounded-xl h-full w-full" />
                </div>
            </div>
            <div className=" pb-4 flex flex-row flex-nowrap gap-2">
                <div className="min-w-[440px] max-w-[440px] h-[400px]">
                    <Skeleton className="italic w-full h-full rounded-xl text-center flex items-center justify-center" >
                    </Skeleton>
                </div>
                <div className="min-w-[440px] max-w-[440px] h-[400px]">
                    <Skeleton className="italic w-full h-full rounded-xl text-center flex items-center justify-center" >
                    </Skeleton>
                </div>
                <div className="min-w-[440px] max-w-[440px] h-[400px]">
                    <Skeleton className="italic w-full h-full rounded-xl text-center flex items-center justify-center" >
                    </Skeleton>
                </div>
                <div className="min-w-[440px] max-w-[440px] h-[400px]">
                    <Skeleton className="italic w-full h-full rounded-xl text-center flex items-center justify-center" >
                    </Skeleton>
                </div>
                <div className="min-w-[440px] max-w-[440px] h-[400px]">
                    <Skeleton className="italic w-full h-full rounded-xl text-center flex items-center justify-center" >
                    </Skeleton>
                </div>
                <div className="min-w-[440px] max-w-[440px] h-[400px]">
                    <Skeleton className="italic w-full h-full rounded-xl text-center flex items-center justify-center" >
                    </Skeleton>
                </div>
            </div>
            <div className=" pb-4 flex flex-row flex-nowrap gap-2">
                <div className="min-w-[440px] max-w-[440px] h-[400px]">
                    <Skeleton className="italic w-full h-full rounded-xl text-center flex items-center justify-center" >
                    </Skeleton>
                </div>
                <div className="min-w-[440px] max-w-[440px] h-[400px]">
                    <Skeleton className="italic w-full h-full rounded-xl text-center flex items-center justify-center" >
                    </Skeleton>
                </div>
                <div className="min-w-[440px] max-w-[440px] h-[400px]">
                    <Skeleton className="italic w-full h-full rounded-xl text-center flex items-center justify-center" >
                    </Skeleton>
                </div>
                <div className="min-w-[440px] max-w-[440px] h-[400px]">
                    <Skeleton className="italic w-full h-full rounded-xl text-center flex items-center justify-center" >
                    </Skeleton>
                </div>
                <div className="min-w-[440px] max-w-[440px] h-[400px]">
                    <Skeleton className="italic w-full h-full rounded-xl text-center flex items-center justify-center" >
                    </Skeleton>
                </div>
                <div className="min-w-[440px] max-w-[440px] h-[400px]">
                    <Skeleton className="italic w-full h-full rounded-xl text-center flex items-center justify-center" >
                    </Skeleton>
                </div>
            </div>
        </>
    );
};
