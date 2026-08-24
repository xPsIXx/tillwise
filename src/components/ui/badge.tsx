import { cn } from "@/lib/utils";
import type { HTMLAttributes } from "react";

export function Badge({
  className,
  tone = "muted",
  ...props
}: HTMLAttributes<HTMLSpanElement> & {
  tone?: "muted" | "accent" | "ok" | "warn";
}) {
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium tracking-wide",
        tone === "muted" && "bg-elevated text-muted",
        tone === "accent" && "bg-accent/15 text-accent",
        tone === "ok" && "bg-accent/15 text-accent",
        tone === "warn" && "bg-danger/15 text-danger",
        className,
      )}
      {...props}
    />
  );
}
