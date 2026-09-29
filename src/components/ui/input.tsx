import * as React from "react";
import { cn } from "@/lib/utils";

function Input({ className, type, ...props }: React.ComponentProps<"input">) {
  return (
    <input
      type={type}
      data-slot="input"
      className={cn(
        "h-10 w-full min-w-0 rounded-md border border-stone-strong bg-paper-raised px-3 text-base text-ink outline-none transition-colors placeholder:text-ink-muted focus-visible:border-tobacco focus-visible:ring-2 focus-visible:ring-tobacco/20 disabled:opacity-50 md:text-sm",
        className,
      )}
      {...props}
    />
  );
}

export { Input };
