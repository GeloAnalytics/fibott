import { NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { spendPoints, refundPoints, InsufficientPointsError } from "@/lib/points";
import { getMikrotikClient, generateVoucherCode } from "@/lib/mikrotik-client";
import { logSystemEvent } from "@/lib/logger";

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

    await logSystemEvent({
      source: "SYSTEM",
      level: "INFO",
      tag: "MIKROTIK",
      message: `Voucher issued successfully via direct REST (${result.code})`,
      details: { voucherId: voucher.id, userId, durationMinutes: voucherRule.durationMinutes },
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

  const failureCategory = result.errorCategory ?? "MIKROTIK_REQUEST_FAILED";

  // If failure is due to direct network connection/reachability (e.g. router behind NAT / on new Wi-Fi without open ports),
  // queue the voucher for outbound MikroTik polling sync:
  const isNetworkFailure =
    failureCategory === "MIKROTIK_HOST_NOT_CONFIGURED" ||
    failureCategory === "MIKROTIK_HOST_UNREACHABLE" ||
    failureCategory === "MIKROTIK_CONNECTION_REFUSED" ||
    failureCategory === "MIKROTIK_CONNECTION_TIMEOUT" ||
    failureCategory === "MIKROTIK_DNS_FAILED";

  if (isNetworkFailure) {
    const code = generateVoucherCode();
    const profile = process.env.MIKROTIK_HOTSPOT_PROFILE ?? "1hour";

    const voucher = await prisma.voucher.update({
      where: { id: voucherId },
      data: {
        code,
        status: "PENDING",
        mikrotikProfile: profile,
      },
    });

    await logSystemEvent({
      source: "SYSTEM",
      level: "INFO",
      tag: "MIKROTIK",
      message: `Direct REST unreachable (${failureCategory}). Voucher queued for outbound router sync (${code})`,
      details: { voucherId: voucher.id, userId, code, failureCategory },
    });

    const user = await prisma.user.findUniqueOrThrow({ where: { id: userId } });
    return NextResponse.json({
      voucherId: voucher.id,
      code: voucher.code,
      durationMinutes: voucher.durationMinutes,
      status: "PENDING",
      expiresAt: new Date(Date.now() + voucher.durationMinutes * 60_000),
      userPointsBalance: user.pointsBalance,
      message: "Voucher generated and queued for HotSpot router activation.",
    });
  }

  const failureDetail = `[${failureCategory}] ${result.errorMessage ?? "Unknown error"}`;

  const balance = await prisma.$transaction(async (tx) => {
    await tx.voucher.update({
      where: { id: voucherId },
      data: { status: "FAILED", failureReason: failureDetail },
    });
    return refundPoints(tx, {
      userId,
      amount: voucherRule.pointsCost,
      voucherId,
    });
  });

  await logSystemEvent({
    source: "SYSTEM",
    level: "ERROR",
    tag: "MIKROTIK",
    message: `Voucher issuance failed (${failureCategory}): ${result.errorMessage ?? "Unknown error"}`,
    details: { voucherId, userId, errorCategory: failureCategory, error: result.errorMessage },
  });

  return NextResponse.json(
    {
      error: "VOUCHER_ISSUANCE_FAILED",
      errorCategory: failureCategory,
      details: result.errorMessage,
      userPointsBalance: balance,
    },
    { status: 502 }
  );
}
