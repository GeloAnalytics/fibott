import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { logSystemEvent } from "@/lib/logger";

function verifyKey(req: Request): boolean {
  const expectedKey = process.env.MIKROTIK_SYNC_KEY;
  if (!expectedKey) return true; // If no key set in env, allow access

  const url = new URL(req.url);
  const key = url.searchParams.get("key") || req.headers.get("x-mikrotik-key");
  return key === expectedKey;
}

export async function GET(req: Request) {
  if (!verifyKey(req)) {
    return new NextResponse("UNAUTHORIZED", { status: 401 });
  }

  const url = new URL(req.url);
  const confirmId = url.searchParams.get("confirm");

  // RouterOS confirming a created voucher
  if (confirmId) {
    const voucher = await prisma.voucher.findUnique({
      where: { id: confirmId },
    });

    if (!voucher) {
      return new NextResponse("NOT_FOUND", { status: 404 });
    }

    if (voucher.status === "PENDING") {
      await prisma.voucher.update({
        where: { id: confirmId },
        data: {
          status: "ISSUED",
          issuedAt: new Date(),
          expiresAt: new Date(Date.now() + voucher.durationMinutes * 60_000),
          mikrotikVoucherRef: voucher.code,
        },
      });

      await logSystemEvent({
        source: "SYSTEM",
        level: "INFO",
        tag: "MIKROTIK",
        message: `Voucher confirmed by MikroTik outbound sync (${voucher.code})`,
        details: { voucherId: voucher.id, userId: voucher.userId },
      });
    }

    return new NextResponse("CONFIRMED", { status: 200 });
  }

  // RouterOS polling for pending vouchers
  const pendingVoucher = await prisma.voucher.findFirst({
    where: { status: "PENDING" },
    orderBy: { createdAt: "asc" },
  });

  if (!pendingVoucher) {
    return new NextResponse("NONE", { status: 200 });
  }

  const profile = pendingVoucher.mikrotikProfile || process.env.MIKROTIK_HOTSPOT_PROFILE || "1hour";
  const durationStr = `${pendingVoucher.durationMinutes}m`;

  // Format: PENDING:id:code:profile:duration
  const payload = `PENDING:${pendingVoucher.id}:${pendingVoucher.code}:${profile}:${durationStr}`;
  return new NextResponse(payload, {
    status: 200,
    headers: { "Content-Type": "text/plain" },
  });
}
