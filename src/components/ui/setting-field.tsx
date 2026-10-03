import type { InputHTMLAttributes } from "react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";

export interface ISettingFieldProps
    extends Omit<InputHTMLAttributes<HTMLInputElement>, "id"> {
    id: string;
    label: string;
    unit: string;
    help: string;
    error?: string;
}

export function SettingField({
    id,
    label,
    unit,
    help,
    error,
    className,
    ...inputProps
}: ISettingFieldProps) {
    return (
        <div className={cn("grid gap-2", className)}>
            <Label htmlFor={id}>{label}</Label>
            <div className="relative">
                <Input
                    id={id}
                    aria-describedby={`${id}-help${error ? ` ${id}-error` : ""}`}
                    aria-invalid={error ? true : undefined}
                    className="pr-24"
                    {...inputProps}
                />
                <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-sm text-muted-foreground">
                    {unit}
                </span>
            </div>
            <p id={`${id}-help`} className="text-sm text-muted-foreground">
                {help}
            </p>
            {error ? (
                <p id={`${id}-error`} className="text-sm text-status-overdue-foreground">
                    {error}
                </p>
            ) : null}
        </div>
    );
}
