"use client";

import { useState } from "react";
import { Coins, Loader2, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { toast } from "sonner";
import { useRouter } from "next/navigation";

interface AdminGrantPointsDialogProps {
  user: {
    id: string;
    name?: string | null;
    email?: string | null;
    pointsBalance: number;
  };
}

const PRESET_AMOUNTS = [50, 100, 250, 500, 1000];

export function AdminGrantPointsDialog({ user }: AdminGrantPointsDialogProps) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [amount, setAmount] = useState<number | "">(100);
  const [reason, setReason] = useState("Leaderboard Reward / Special Bonus");
  const [submitting, setSubmitting] = useState(false);

  const handleGrant = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!amount || Number(amount) <= 0) {
      toast.error("Please enter a valid points amount");
      return;
    }
    if (!reason.trim()) {
      toast.error("Please enter a reason for granting points");
      return;
    }

    setSubmitting(true);
    try {
      const res = await fetch("/api/admin/users/points", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          userId: user.id,
          amount: Number(amount),
          reason: reason.trim(),
        }),
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to grant points");

      toast.success(data.message || `Granted ${amount} points to ${user.email ?? user.name}!`);
      setOpen(false);
      router.refresh();
    } catch (err: any) {
      toast.error(err.message || "Failed to grant points");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger
        render={
          <Button variant="outline" size="sm" className="h-8 text-xs gap-1.5 text-amber-600 dark:text-amber-400 hover:text-amber-700">
            <Coins className="size-3.5" />
            Grant Points
          </Button>
        }
      />

      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-base">
            <Coins className="size-4 text-amber-500" />
            Grant Free Points
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-4 pt-2">
          <div className="rounded-lg bg-muted/60 p-3 text-xs space-y-1">
            <div className="flex items-center justify-between">
              <p className="font-semibold text-foreground">{user.name ?? "User Account"}</p>
              <span className="font-mono font-medium text-emerald-600 dark:text-emerald-400">
                Current: {user.pointsBalance} pts
              </span>
            </div>
            <p className="text-muted-foreground font-mono">{user.email}</p>
          </div>

          <form onSubmit={handleGrant} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="pointsAmount" className="text-xs">
                Points to Award
              </Label>
              <Input
                id="pointsAmount"
                type="number"
                min="1"
                step="1"
                value={amount}
                onChange={(e) => setAmount(e.target.value === "" ? "" : Number(e.target.value))}
                placeholder="e.g. 500"
                className="font-mono text-sm"
                required
              />
              {/* Preset buttons */}
              <div className="flex flex-wrap gap-1.5 pt-1">
                {PRESET_AMOUNTS.map((preset) => (
                  <button
                    key={preset}
                    type="button"
                    onClick={() => setAmount(preset)}
                    className={`rounded px-2 py-0.5 text-xs font-medium transition-colors ${
                      amount === preset
                        ? "bg-amber-500 text-white"
                        : "bg-secondary text-secondary-foreground hover:bg-secondary/80"
                    }`}
                  >
                    +{preset}
                  </button>
                ))}
              </div>
            </div>

            <div className="space-y-2">
              <Label htmlFor="pointsReason" className="text-xs">
                Reason / Note (Shown in user&apos;s notification inbox)
              </Label>
              <Input
                id="pointsReason"
                type="text"
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                placeholder="e.g. Leaderboard Rank #1 Award, Promo Reward"
                className="text-sm"
                maxLength={200}
                required
              />
              <p className="text-[11px] text-muted-foreground">
                The user will receive an inbox notification detailing this exact reason and amount.
              </p>
            </div>

            <div className="flex justify-end gap-2 pt-2">
              <Button type="button" variant="outline" size="sm" onClick={() => setOpen(false)}>
                Cancel
              </Button>
              <Button
                type="submit"
                size="sm"
                disabled={submitting}
                className="bg-gradient-to-r from-amber-500 to-amber-600 hover:from-amber-600 hover:to-amber-700 text-white gap-1.5"
              >
                {submitting ? (
                  <Loader2 className="size-3.5 animate-spin" />
                ) : (
                  <Sparkles className="size-3.5" />
                )}
                {submitting ? "Awarding..." : `Grant ${amount || 0} Points`}
              </Button>
            </div>
          </form>
        </div>
      </DialogContent>
    </Dialog>
  );
}
