/**
 * @module button
 * Primary action control with variants (default, destructive, outline, secondary,
 * ghost, link) and sizes (default, sm, lg, icon). Supports asChild for composition.
 * Depends on: @radix-ui/react-slot, class-variance-authority, @/lib/utils.
 * Used by: DayCard, Chat, ProgramPreview, and many feature components.
 */

import * as React from "react";
import { Slot } from "@radix-ui/react-slot";
import { cva, type VariantProps } from "class-variance-authority";

import { cn } from "@/lib/utils";

const buttonVariants = cva(
  "cursor-pointer inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-lg text-base font-semibold transition-colors focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:size-4 [&_svg]:shrink-0",
  {
    variants: {
      variant: {
        default:
          "bg-primary text-primary-foreground hover:bg-primary/90",
        destructive:
          "bg-destructive text-destructive-foreground hover:bg-destructive/90",
        outline:
          "border-2 border-input bg-background hover:bg-accent hover:text-accent-foreground",
        secondary:
          "bg-secondary text-secondary-foreground hover:bg-secondary/80",
        ghost: "hover:bg-accent hover:text-accent-foreground",
        link: "text-primary underline-offset-4 hover:underline",
      },
      size: {
        default: "h-11 px-4 py-2",
        sm: "h-11 rounded-lg px-3 text-sm",
        lg: "h-11 rounded-lg px-8",
        icon: "h-11 w-11",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  },
);

/**
 * @param asChild - When true, render as child component (Slot) instead of <button>.
 * @param variant - Visual style: default | destructive | outline | secondary | ghost | link.
 * @param size - default | sm | lg | icon.
 */
export interface IButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {
  asChild?: boolean
}

/** Renders a styled button or composed element when asChild is true. */
const Button = React.forwardRef<HTMLButtonElement, IButtonProps>(
  ({ className, variant, size, asChild = false, ...props }, ref) => {
    const Comp = asChild ? Slot : "button";
    return (
        <Comp
        className={ cn(buttonVariants({ variant, size, className })) }
        ref={ ref }
        { ...props }
      />
    );
  },
);
Button.displayName = "Button";

export { Button, buttonVariants };
