import { prisma } from "@/lib/prisma";

/**
 * Vouchers only get their `expiresAt` (the MikroTik hotspot uptime deadline)
 * checked at issuance time — nothing else ever revisits it, so an ISSUED
 * voucher stays ISSUED forever even long after it has actually expired.
 * Call this before displaying any voucher list so the status shown matches
 * reality.
 */
export async function expireStaleVouchers() {
  await prisma.voucher.updateMany({
    where: { status: "ISSUED", expiresAt: { lte: new Date() } },
    data: { status: "EXPIRED" },
  });
}
