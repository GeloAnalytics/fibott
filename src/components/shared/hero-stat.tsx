"use client";

import { useCountUp } from "./use-count-up";
import { cn } from "@/lib/utils";

export function HeroStat({
  value,
  label,
  qualifier,
}: {
  value: number;
  label: string;
  qualifier: string;
}) {
  const displayed = useCountUp(value);

  return (
    <div className="rounded-xl border bg-card p-4 sm:px-8 sm:py-7 shadow-xs">
      <p className="text-xs sm:text-sm font-medium text-muted-foreground">{label}</p>
      <div
        className={cn(
          "mt-1 font-display text-4xl font-bold tracking-tight text-primary tabular-nums sm:text-6xl"
        )}
      >
        {displayed}
      </div>
      <p className="mt-1.5 text-xs sm:text-sm text-muted-foreground leading-relaxed">{qualifier}</p>
    </div>
  );
}
