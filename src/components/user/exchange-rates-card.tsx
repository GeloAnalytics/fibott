import { Coins, Flame, Ticket } from "lucide-react";
import type { MaterialType } from "@/generated/prisma/enums";

interface RewardRule {
  id: string;
  materialType: MaterialType;
  pointsPerItem: number;
  isActive: boolean;
}

interface VoucherRule {
  id: string;
  label: string;
  pointsCost: number;
  durationMinutes: number;
  isActive: boolean;
}

interface ExchangeRatesCardProps {
  rewardRules: RewardRule[];
  voucherRules: VoucherRule[];
}

export function ExchangeRatesCard({
  rewardRules,
  voucherRules,
}: ExchangeRatesCardProps) {
  const activeRewards = rewardRules.filter((r) => r.isActive);
  const activeVouchers = voucherRules.filter((v) => v.isActive);

  return (
    <div className="rounded-xl border bg-card p-5 text-card-foreground shadow-sm">
      <div className="flex items-center justify-between border-b pb-3">
        <div className="flex items-center gap-2">
          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-emerald-500/10 text-emerald-600 dark:text-emerald-400">
            <Coins className="h-4 w-4" />
          </div>
          <div>
            <h3 className="font-semibold text-foreground">Current Exchange Rates</h3>
            <p className="text-xs text-muted-foreground">
              Official recycling rewards & voucher redemption rates set by admin
            </p>
          </div>
        </div>
        <span className="inline-flex items-center rounded-full bg-emerald-50 px-2.5 py-0.5 text-xs font-medium text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-400">
          Live Rates
        </span>
      </div>

      <div className="mt-4 grid gap-4 sm:grid-cols-2">
        {/* Deposit Earnings Section */}
        <div className="space-y-2.5 rounded-lg bg-muted/40 p-3.5">
          <div className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            <Flame className="h-3.5 w-3.5 text-amber-500" />
            Recycling Rewards (Per Item)
          </div>
          {activeRewards.length === 0 ? (
            <p className="text-xs text-muted-foreground">No active reward rates set.</p>
          ) : (
            <div className="space-y-2">
              {activeRewards.map((rule) => {
                const label =
                  rule.materialType === "PET_BOTTLE"
                    ? "Plastic Bottle (PET)"
                    : rule.materialType === "ALUMINUM_CAN"
                    ? "Aluminum Drink Can"
                    : rule.materialType;

                const icon =
                  rule.materialType === "PET_BOTTLE" ? "🍾" : "🥤";

                return (
                  <div
                    key={rule.id}
                    className="flex items-center justify-between rounded-md bg-background px-3 py-2 text-sm border shadow-2xs"
                  >
                    <span className="flex items-center gap-2 font-medium">
                      <span>{icon}</span>
                      <span>{label}</span>
                    </span>
                    <span className="font-bold text-emerald-600 dark:text-emerald-400">
                      +{rule.pointsPerItem} pts
                    </span>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Voucher Redemption Rates Section */}
        <div className="space-y-2.5 rounded-lg bg-muted/40 p-3.5">
          <div className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            <Ticket className="h-3.5 w-3.5 text-sky-500" />
            Wi-Fi Vouchers (Exchange Cost)
          </div>
          {activeVouchers.length === 0 ? (
            <p className="text-xs text-muted-foreground">No active voucher packages.</p>
          ) : (
            <div className="space-y-2">
              {activeVouchers.map((rule) => {
                const hrs = (rule.durationMinutes / 60).toFixed(
                  rule.durationMinutes % 60 === 0 ? 0 : 1
                );
                return (
                  <div
                    key={rule.id}
                    className="flex items-center justify-between rounded-md bg-background px-3 py-2 text-sm border shadow-2xs"
                  >
                    <span className="font-medium">
                      📶 {rule.label || `${hrs} Hour${Number(hrs) > 1 ? "s" : ""} Wi-Fi Access`}
                    </span>
                    <span className="font-bold text-sky-600 dark:text-sky-400">
                      {rule.pointsCost} pts
                    </span>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
