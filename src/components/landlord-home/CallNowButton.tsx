"use client";

/**
 * @module CallNowButton
 * Toolbar action that rings the demo collection call (John Reyes, Sunset Properties) to a
 * number the user picks, prefilled with DEMO_TENANT_PHONE.
 * Depends on: /api/calls/demo, popover, input, label, button, sonner.
 * Used by: LandlordHome.
 */

import { useState, type FormEvent } from "react";
import { Phone } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";

const ENDPOINT = "/api/calls/demo";

async function readError(response: Response): Promise<string> {
    const body: unknown = await response.json().catch(() => null);
    const error = body && typeof body === "object" && "error" in body ? body.error : null;
    return typeof error === "string" ? error : "Couldn't place the call.";
}

/** "Call now" button with a phone form in a popover. */
export function CallNowButton() {
    const [open, setOpen] = useState(false);
    const [phone, setPhone] = useState("");
    const [calling, setCalling] = useState(false);

    const onOpenChange = (next: boolean) => {
        setOpen(next);
        if (next && !phone) {
            void fetch(ENDPOINT)
                .then(async (response) => (response.ok ? response.json() as Promise<{ defaultPhone?: string }> : null))
                .then((body) => setPhone((current) => current || body?.defaultPhone || ""))
                .catch(() => undefined);
        }
    };

    const onSubmit = async (event: FormEvent) => {
        event.preventDefault();
        setCalling(true);
        try {
            const response = await fetch(ENDPOINT, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ phone: phone.trim() }),
            });
            if (!response.ok) {
                toast.error(await readError(response));
                return;
            }
            toast.success(`Calling ${phone.trim()}…`);
            setOpen(false);
        } catch {
            toast.error("Couldn't place the call.");
        } finally {
            setCalling(false);
        }
    };

    return (
        <Popover open={ open } onOpenChange={ onOpenChange }>
            <PopoverTrigger asChild>
                <Button size="sm" className="gap-1.5">
                    <Phone className="size-3.5" />
                    Call now
                </Button>
            </PopoverTrigger>
            <PopoverContent align="end" className="w-80">
                <form onSubmit={ onSubmit } className="flex flex-col gap-3">
                    <div className="flex flex-col gap-1.5">
                        <Label htmlFor="call-now-phone">Phone number</Label>
                        <Input
                            id="call-now-phone"
                            type="tel"
                            inputMode="tel"
                            placeholder="+61416827278"
                            value={ phone }
                            onChange={ (event) => setPhone(event.target.value) }
                            autoFocus
                        />
                        <p className="text-xs text-muted-foreground">
                            Rings the demo call: John Reyes, Sunset Properties, $2,400 overdue.
                        </p>
                    </div>
                    <Button type="submit" size="sm" disabled={ calling || !phone.trim() }>
                        { calling ? "Calling…" : "Call" }
                    </Button>
                </form>
            </PopoverContent>
        </Popover>
    );
}
