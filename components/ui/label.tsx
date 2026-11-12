import type * as React from "react";
import { cn } from "@/lib/utils";

export function Label({ className, ...props }: React.ComponentProps<"label">) {
  return (
    // biome-ignore lint/a11y/noLabelWithoutControl: association is provided by callers via htmlFor
    <label
      className={cn("text-sm font-medium leading-none text-[var(--ink)]", className)}
      {...props}
    />
  );
}
