"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

import { VoucherActions } from "@/components/user/voucher-actions";

interface VoucherRuleOption {
  id: string;
  label: string;
  pointsCost: number;
  durationMinutes: number;
}

export function RedeemSection({
  rules,
  pointsBalance,
}: {
  rules: VoucherRuleOption[];
  pointsBalance: number;
}) {
  const router = useRouter();
  const [redeemingId, setRedeemingId] = useState<string | null>(null);
  const [redeemedCode, setRedeemedCode] = useState<string | null>(null);

  async function handleRedeem(ruleId: string) {
    setRedeemingId(ruleId);
    setRedeemedCode(null);
    const res = await fetch("/api/vouchers/redeem", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ voucherRuleId: ruleId }),
    });
    const data = await res.json().catch(() => ({}));
    setRedeemingId(null);

    if (!res.ok) {
      toast.error(
        data.error === "INSUFFICIENT_POINTS"
          ? "You don't have enough points for this voucher yet."
          : data.error === "VOUCHER_ISSUANCE_FAILED"
            ? "Couldn't issue your WiFi voucher right now — your points were refunded. Please try again shortly."
            : "Something went wrong. Please try again."
      );
      router.refresh();
      return;
    }

    setRedeemedCode(data.code);
    router.refresh();
  }

  if (rules.length === 0) {
    return null;
  }

  return (
    <div className="space-y-3">
      <h2 className="text-lg font-medium">Redeem for WiFi</h2>

      {redeemedCode && <VoucherActions code={redeemedCode} />}

      <div className="space-y-2.5">
        {rules.map((rule) => {
          const canAfford = pointsBalance >= rule.pointsCost;
          return (
            <div
              key={rule.id}
              className="flex items-center justify-between gap-3 rounded-xl border bg-card p-3 sm:p-4 shadow-xs hover:border-primary/40 transition-colors"
            >
              <div className="flex items-center gap-3 min-w-0">
                <div className="flex size-9 sm:size-10 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary font-semibold text-sm sm:text-base">
                  📶
                </div>
                <div className="min-w-0">
                  <div className="flex items-center gap-1.5 flex-wrap">
                    <h3 className="font-semibold text-sm text-foreground">{rule.label}</h3>
                    <span className="rounded-full bg-secondary px-2 py-0.5 text-[10px] font-mono text-muted-foreground">
                      {rule.durationMinutes}m
                    </span>
                  </div>
                  <p className="text-xs font-semibold text-primary tabular-nums mt-0.5">
                    {rule.pointsCost} points
                  </p>
                </div>
              </div>
              <Button
                size="sm"
                disabled={!canAfford || redeemingId === rule.id}
                onClick={() => handleRedeem(rule.id)}
                className="shrink-0 h-8 px-3 text-xs font-semibold shadow-xs"
              >
                {redeemingId === rule.id && (
                  <Loader2 className="size-3.5 animate-spin mr-1" aria-hidden="true" />
                )}
                {redeemingId === rule.id
                  ? "Redeeming…"
                  : canAfford
                    ? "Redeem"
                    : `Need ${rule.pointsCost - pointsBalance} pts`}
              </Button>
            </div>
          );
        })}
      </div>
    </div>
  );
}
