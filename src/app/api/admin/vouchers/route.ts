import { NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { getMikrotikClient, generateVoucherCode } from "@/lib/mikrotik-client";
import { logSystemEvent } from "@/lib/logger";

const schema = z.object({
  userId: z.string(),
  voucherRuleId: z.string(),
});

/**
 * Admin-initiated voucher grant: an admin issues a HotSpot voucher directly
 * to a user of their choosing, outside the normal points-redemption flow.
 * Unlike /api/vouchers/redeem, this never touches the recipient's points
 * balance -- it's a free grant, so pointsCost is recorded as 0 and no
 * PointsTransaction is created.
 */
export async function POST(req: Request) {
  const session = await auth();
  if (!session?.user || session.user.role !== "ADMIN") {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await req.json().catch(() => null);
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid input" }, { status: 400 });
  }

  const { userId, voucherRuleId } = parsed.data;

  const [voucherRule, targetUser] = await Promise.all([
    prisma.voucherRule.findUnique({ where: { id: voucherRuleId } }),
    prisma.user.findUnique({ where: { id: userId } }),
  ]);

  if (!voucherRule || !voucherRule.isActive) {
    return NextResponse.json({ error: "Voucher option not available" }, { status: 400 });
  }
  if (!targetUser) {
    return NextResponse.json({ error: "User not found" }, { status: 404 });
  }

  const voucher = await prisma.voucher.create({
    data: {
      userId,
      voucherRuleId: voucherRule.id,
      code: `PENDING-${Date.now()}`,
      pointsCost: 0,
      durationMinutes: voucherRule.durationMinutes,
      status: "PENDING",
    },
  });

  const mikrotik = getMikrotikClient();
  const result = await mikrotik.createHotspotVoucher({
    durationMinutes: voucherRule.durationMinutes,
    label: voucher.id,
  });

  if (result.success && result.code) {
    const issued = await prisma.voucher.update({
      where: { id: voucher.id },
      data: {
        status: "ISSUED",
        code: result.code,
        mikrotikVoucherRef: result.voucherRef,
        issuedAt: new Date(),
        expiresAt: result.expiresAt,
      },
    });

    await Promise.all([
      logSystemEvent({
        source: "SYSTEM",
        level: "INFO",
        tag: "MIKROTIK",
        message: `Voucher admin-granted and issued via direct REST (${result.code})`,
        details: { voucherId: issued.id, grantedToUserId: userId, adminId: session.user.id },
      }),
      prisma.auditLog.create({
        data: {
          actorId: session.user.id,
          action: "VOUCHER_ADMIN_GRANTED",
          targetType: "Voucher",
          targetId: issued.id,
          metadata: {
            grantedToUserId: userId,
            grantedToEmail: targetUser.email,
            voucherRuleId: voucherRule.id,
            durationMinutes: voucherRule.durationMinutes,
            status: issued.status,
          },
        },
      }),
    ]);

    return NextResponse.json({
      voucherId: issued.id,
      code: issued.code,
      durationMinutes: issued.durationMinutes,
      status: issued.status,
      expiresAt: issued.expiresAt,
      grantedTo: { id: targetUser.id, name: targetUser.name, email: targetUser.email },
    });
  }

  const failureCategory = result.errorCategory ?? "MIKROTIK_REQUEST_FAILED";

  const isNetworkFailure =
    failureCategory === "MIKROTIK_HOST_NOT_CONFIGURED" ||
    failureCategory === "MIKROTIK_HOST_UNREACHABLE" ||
    failureCategory === "MIKROTIK_CONNECTION_REFUSED" ||
    failureCategory === "MIKROTIK_CONNECTION_TIMEOUT" ||
    failureCategory === "MIKROTIK_DNS_FAILED";

  if (isNetworkFailure) {
    const code = generateVoucherCode();
    const profile = process.env.MIKROTIK_HOTSPOT_PROFILE ?? "1hour";

    const queued = await prisma.voucher.update({
      where: { id: voucher.id },
      data: {
        code,
        status: "PENDING",
        mikrotikProfile: profile,
      },
    });

    await Promise.all([
      logSystemEvent({
        source: "SYSTEM",
        level: "INFO",
        tag: "MIKROTIK",
        message: `Direct REST unreachable (${failureCategory}). Admin-granted voucher queued for outbound router sync (${code})`,
        details: { voucherId: queued.id, grantedToUserId: userId, code, failureCategory, adminId: session.user.id },
      }),
      prisma.auditLog.create({
        data: {
          actorId: session.user.id,
          action: "VOUCHER_ADMIN_GRANTED",
          targetType: "Voucher",
          targetId: queued.id,
          metadata: {
            grantedToUserId: userId,
            grantedToEmail: targetUser.email,
            voucherRuleId: voucherRule.id,
            durationMinutes: voucherRule.durationMinutes,
            status: "PENDING",
          },
        },
      }),
    ]);

    return NextResponse.json({
      voucherId: queued.id,
      code: queued.code,
      durationMinutes: queued.durationMinutes,
      status: "PENDING",
      expiresAt: new Date(Date.now() + queued.durationMinutes * 60_000),
      grantedTo: { id: targetUser.id, name: targetUser.name, email: targetUser.email },
      message: "Voucher generated and queued for HotSpot router activation.",
    });
  }

  const failureDetail = `[${failureCategory}] ${result.errorMessage ?? "Unknown error"}`;

  await prisma.voucher.update({
    where: { id: voucher.id },
    data: { status: "FAILED", failureReason: failureDetail },
  });

  await logSystemEvent({
    source: "SYSTEM",
    level: "ERROR",
    tag: "MIKROTIK",
    message: `Admin voucher grant failed (${failureCategory}): ${result.errorMessage ?? "Unknown error"}`,
    details: { voucherId: voucher.id, grantedToUserId: userId, errorCategory: failureCategory, error: result.errorMessage, adminId: session.user.id },
  });

  return NextResponse.json(
    {
      error: "VOUCHER_ISSUANCE_FAILED",
      errorCategory: failureCategory,
      details: result.errorMessage,
    },
    { status: 502 }
  );
}
