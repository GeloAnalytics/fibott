import { NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

const schema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("reward"),
    rewardRuleId: z.string(),
    pointsPerItem: z.number().int().min(0),
  }),
  z.object({
    type: z.literal("voucher"),
    voucherRuleId: z.string(),
    pointsCost: z.number().int().min(1),
    durationMinutes: z.number().int().min(1),
    isActive: z.boolean().optional(),
  }),
]);

const createVoucherRuleSchema = z.object({
  label: z.string().trim().min(1).max(60),
  pointsCost: z.number().int().min(1),
  durationMinutes: z.number().int().min(1),
});

/**
 * Creates a new voucher tier (e.g. "30 Min WiFi" -- 50 points / 30 minutes)
 * alongside whatever tiers already exist. Every redemption surface (wallet
 * redeem, admin grant dialog) already lists all VoucherRule rows with
 * isActive: true, so a new tier shows up everywhere automatically -- no
 * MikroTik or ESP32 changes are needed, since voucher creation already
 * accepts an arbitrary durationMinutes per voucher (see mikrotik-client.ts).
 */
export async function POST(req: Request) {
  const session = await auth();
  if (!session?.user || session.user.role !== "ADMIN") {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await req.json().catch(() => null);
  const parsed = createVoucherRuleSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid input" }, { status: 400 });
  }

  const rule = await prisma.voucherRule.create({
    data: {
      label: parsed.data.label,
      pointsCost: parsed.data.pointsCost,
      durationMinutes: parsed.data.durationMinutes,
    },
  });

  await prisma.auditLog.create({
    data: {
      actorId: session.user.id,
      action: "VOUCHER_RULE_CREATED",
      targetType: "VoucherRule",
      targetId: rule.id,
      metadata: { label: rule.label, pointsCost: rule.pointsCost, durationMinutes: rule.durationMinutes },
    },
  });

  return NextResponse.json({ ok: true, rule });
}

export async function PATCH(req: Request) {
  const session = await auth();
  if (!session?.user || session.user.role !== "ADMIN") {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await req.json().catch(() => null);
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid input" }, { status: 400 });
  }

  if (parsed.data.type === "reward") {
    const rule = await prisma.rewardRule.update({
      where: { id: parsed.data.rewardRuleId },
      data: { pointsPerItem: parsed.data.pointsPerItem },
    });
    await prisma.auditLog.create({
      data: {
        actorId: session.user.id,
        action: "REWARD_RULE_UPDATED",
        targetType: "RewardRule",
        targetId: rule.id,
        metadata: { materialType: rule.materialType, pointsPerItem: rule.pointsPerItem },
      },
    });
    return NextResponse.json({ ok: true, rule });
  }

  const rule = await prisma.voucherRule.update({
    where: { id: parsed.data.voucherRuleId },
    data: {
      pointsCost: parsed.data.pointsCost,
      durationMinutes: parsed.data.durationMinutes,
      ...(parsed.data.isActive !== undefined ? { isActive: parsed.data.isActive } : {}),
    },
  });
  await prisma.auditLog.create({
    data: {
      actorId: session.user.id,
      action: "VOUCHER_RULE_UPDATED",
      targetType: "VoucherRule",
      targetId: rule.id,
      metadata: {
        pointsCost: rule.pointsCost,
        durationMinutes: rule.durationMinutes,
        isActive: rule.isActive,
      },
    },
  });
  return NextResponse.json({ ok: true, rule });
}
