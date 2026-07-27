"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

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

      {redeemedCode && (
        <div className="rounded-lg border border-reward bg-reward/20 p-4">
          <p className="text-sm font-medium text-reward-foreground">
            Voucher issued! Use this code to connect:
          </p>
          <p className="mt-1 font-mono text-2xl font-semibold text-reward-foreground">
            {redeemedCode}
          </p>
        </div>
      )}

      <div className="grid gap-4 sm:grid-cols-2">
        {rules.map((rule) => {
          const canAfford = pointsBalance >= rule.pointsCost;
          return (
            <Card key={rule.id}>
              <CardHeader className="pb-2">
                <CardTitle className="text-base">{rule.label}</CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                <p className="text-sm text-muted-foreground tabular-nums">
                  {rule.pointsCost} points &middot; {rule.durationMinutes} minutes of WiFi
                </p>
                <Button
                  className="w-full"
                  disabled={!canAfford || redeemingId === rule.id}
                  onClick={() => handleRedeem(rule.id)}
                >
                  {redeemingId === rule.id && (
                    <Loader2 className="size-4 animate-spin" aria-hidden="true" />
                  )}
                  {redeemingId === rule.id
                    ? "Redeeming"
                    : canAfford
                      ? "Redeem"
                      : `Need ${rule.pointsCost - pointsBalance} more points`}
                </Button>
              </CardContent>
            </Card>
          );
        })}
      </div>
    </div>
  );
}
