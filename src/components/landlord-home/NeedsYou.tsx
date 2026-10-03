/**
 * @module NeedsYou
 * Agents waiting on a person or sitting on handoff. Open call is a stub until 06.
 * Depends on: home-derived, badge, button, status-badge.
 * Used by: LandlordHome.
 */

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { StatusBadge } from "@/components/ui/status-badge";
import type { INeedsYouItem } from "@/lib/landlord-home/home-derived";

const HEADING = "text-[11px] font-semibold uppercase tracking-[1.5px] text-muted-foreground";

export interface INeedsYouProps {
    items: readonly INeedsYouItem[];
    onOpenAgent?: (id: string) => void;
}

/** People the landlord still has to take. Empty when the list is clear. */
export function NeedsYou({ items, onOpenAgent }: INeedsYouProps) {
    return (
        <section aria-label="Needs you" className="space-y-3">
            <h2 className={ HEADING }>Needs you</h2>
            { items.length === 0 ? (
                <p className="text-sm text-muted-foreground">No one needs you.</p>
            ) : (
                <ul className="divide-y rounded-[1.25rem] border">
                    { items.map((item) => (
                        <li key={ item.id } className="flex items-center gap-3 px-4 py-3">
                            <div className="min-w-0 flex-1">
                                <p className="truncate font-medium">{ item.tenant }</p>
                                <p className="truncate text-sm text-muted-foreground">{ item.property }</p>
                            </div>
                            { item.badge === "handoff" ? (
                                <Badge variant="outline">Handoff</Badge>
                            ) : (
                                <StatusBadge status="waiting-on-person" />
                            ) }
                            <Button
                                type="button"
                                variant="outline"
                                size="sm"
                                onClick={ () => onOpenAgent?.(item.id) }
                            >
                                Open call
                            </Button>
                        </li>
                    )) }
                </ul>
            ) }
        </section>
    );
}
