import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { cn } from "@/lib/utils";

export function StatCard({
  label,
  value,
  hint,
  emphasis = false,
  size = "default",
  className,
}: {
  label: string;
  value: string | number;
  hint?: string;
  emphasis?: boolean;
  size?: "default" | "lg";
  className?: string;
}) {
  return (
    <Card className={cn("h-full", className)}>
      <CardHeader className="pb-2">
        <CardTitle
          className={cn(
            "font-medium text-muted-foreground",
            size === "lg" ? "text-sm" : "text-sm"
          )}
        >
          {label}
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div
          className={cn(
            "font-semibold tracking-tight tabular-nums",
            size === "lg" ? "text-5xl" : "text-3xl",
            emphasis && "text-primary"
          )}
        >
          {value}
        </div>
        {hint && <p className="mt-1 text-xs text-muted-foreground">{hint}</p>}
      </CardContent>
    </Card>
  );
}
