import { NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { spendPoints, refundPoints, InsufficientPointsError } from "@/lib/points";
import { getMikrotikClient } from "@/lib/mikrotik-client";

const schema = z.object({ voucherRuleId: z.string() });

export async function POST(req: Request) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await req.json().catch(() => null);
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid input" }, { status: 400 });
  }

  const voucherRule = await prisma.voucherRule.findUnique({
    where: { id: parsed.data.voucherRuleId },
  });
  if (!voucherRule || !voucherRule.isActive) {
    return NextResponse.json({ error: "Voucher option not available" }, { status: 400 });
  }

  const userId = session.user.id;

  let voucherId: string;
  try {
    voucherId = await prisma.$transaction(async (tx) => {
      const voucher = await tx.voucher.create({
        data: {
          userId,
          voucherRuleId: voucherRule.id,
          code: `PENDING-${Date.now()}`,
          pointsCost: voucherRule.pointsCost,
          durationMinutes: voucherRule.durationMinutes,
          status: "PENDING",
        },
      });

      await spendPoints(tx, {
        userId,
        amount: voucherRule.pointsCost,
        source: "VOUCHER_REDEMPTION",
        voucherId: voucher.id,
      });

      return voucher.id;
    });
  } catch (err) {
    if (err instanceof InsufficientPointsError) {
      return NextResponse.json({ error: "INSUFFICIENT_POINTS" }, { status: 400 });
    }
    throw err;
  }

  const mikrotik = getMikrotikClient();
  const result = await mikrotik.createHotspotVoucher({
    durationMinutes: voucherRule.durationMinutes,
    label: voucherId,
  });

  if (result.success && result.code) {
    const voucher = await prisma.voucher.update({
      where: { id: voucherId },
      data: {
        status: "ISSUED",
        code: result.code,
        mikrotikVoucherRef: result.voucherRef,
        issuedAt: new Date(),
        expiresAt: result.expiresAt,
      },
    });
    const user = await prisma.user.findUniqueOrThrow({ where: { id: userId } });
    return NextResponse.json({
      voucherId: voucher.id,
      code: voucher.code,
      durationMinutes: voucher.durationMinutes,
      status: voucher.status,
      expiresAt: voucher.expiresAt,
      userPointsBalance: user.pointsBalance,
    });
  }

  const balance = await prisma.$transaction(async (tx) => {
    await tx.voucher.update({
      where: { id: voucherId },
      data: { status: "FAILED", failureReason: result.errorMessage ?? "Unknown error" },
    });
    return refundPoints(tx, {
      userId,
      amount: voucherRule.pointsCost,
      voucherId,
    });
  });

  return NextResponse.json(
    { error: "VOUCHER_ISSUANCE_FAILED", userPointsBalance: balance },
    { status: 502 }
  );
}
