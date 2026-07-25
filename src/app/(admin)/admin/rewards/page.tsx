import { prisma } from "@/lib/prisma";
import { RewardRuleForm } from "./reward-rule-form";
import { VoucherRuleForm } from "./voucher-rule-form";

export default async function AdminRewardsPage() {
  const [rewardRules, voucherRules] = await Promise.all([
    prisma.rewardRule.findMany({ orderBy: { materialType: "asc" } }),
    prisma.voucherRule.findMany({ orderBy: { pointsCost: "asc" } }),
  ]);

  return (
    <div className="max-w-2xl space-y-8">
      <div>
        <h1 className="text-2xl font-semibold">Rewards Management</h1>
        <p className="text-sm text-muted-foreground">
          Configure how many points each material earns, and how points convert to WiFi
          vouchers.
        </p>
      </div>

      <div className="space-y-4">
        <h2 className="text-lg font-medium">Points per material</h2>
        {rewardRules.map((rule) => (
          <RewardRuleForm
            key={rule.id}
            id={rule.id}
            materialType={rule.materialType}
            pointsPerItem={rule.pointsPerItem}
          />
        ))}
      </div>

      <div className="space-y-4">
        <h2 className="text-lg font-medium">Voucher conversions</h2>
        {voucherRules.map((rule) => (
          <VoucherRuleForm
            key={rule.id}
            id={rule.id}
            label={rule.label}
            pointsCost={rule.pointsCost}
            durationMinutes={rule.durationMinutes}
          />
        ))}
      </div>
    </div>
  );
}
