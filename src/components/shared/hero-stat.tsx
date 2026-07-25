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
    <div className="rounded-lg border bg-card px-6 py-8 sm:px-8 sm:py-10">
      <p className="text-sm font-medium text-muted-foreground">{label}</p>
      <div
        className={cn(
          "mt-2 font-display text-6xl font-semibold tracking-[-0.02em] text-primary tabular-nums sm:text-7xl"
        )}
      >
        {displayed}
      </div>
      <p className="mt-3 max-w-prose text-base text-foreground">{qualifier}</p>
    </div>
  );
}
