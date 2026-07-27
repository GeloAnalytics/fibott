import { Prisma } from "@/generated/prisma/client";
import { TransactionSource } from "@/generated/prisma/enums";

type Tx = Prisma.TransactionClient;

export async function awardPoints(
  tx: Tx,
  params: {
    userId: string;
    amount: number;
    source: TransactionSource;
    depositId?: string;
    note?: string;
  }
): Promise<number> {
  const user = await tx.user.update({
    where: { id: params.userId },
    data: { pointsBalance: { increment: params.amount } },
  });

  await tx.pointsTransaction.create({
    data: {
      userId: params.userId,
      type: "EARN",
      amount: params.amount,
      balanceAfter: user.pointsBalance,
      source: params.source,
      depositId: params.depositId,
      note: params.note,
    },
  });

  return user.pointsBalance;
}

export class InsufficientPointsError extends Error {
  constructor() {
    super("INSUFFICIENT_POINTS");
  }
}

export async function spendPoints(
  tx: Tx,
  params: {
    userId: string;
    amount: number;
    source: TransactionSource;
    voucherId?: string;
    note?: string;
  }
): Promise<number> {
  // A separate read-then-check-then-write here would race under concurrent
  // requests (e.g. a double-submitted redemption): both could read a
  // sufficient balance before either commits, and since pointsBalance has
  // no non-negative constraint at the DB level, both would succeed and push
  // the balance negative. Folding the balance check into the UPDATE's WHERE
  // clause makes the check-and-decrement a single atomic operation.
  const result = await tx.user.updateMany({
    where: { id: params.userId, pointsBalance: { gte: params.amount } },
    data: { pointsBalance: { decrement: params.amount } },
  });
  if (result.count === 0) {
    throw new InsufficientPointsError();
  }

  const user = await tx.user.findUniqueOrThrow({ where: { id: params.userId } });

  await tx.pointsTransaction.create({
    data: {
      userId: params.userId,
      type: "SPEND",
      amount: params.amount,
      balanceAfter: user.pointsBalance,
      source: params.source,
      voucherId: params.voucherId,
      note: params.note,
    },
  });

  return user.pointsBalance;
}

export async function refundPoints(
  tx: Tx,
  params: {
    userId: string;
    amount: number;
    voucherId?: string;
    note?: string;
  }
): Promise<number> {
  const user = await tx.user.update({
    where: { id: params.userId },
    data: { pointsBalance: { increment: params.amount } },
  });

  await tx.pointsTransaction.create({
    data: {
      userId: params.userId,
      type: "ADJUSTMENT",
      amount: params.amount,
      balanceAfter: user.pointsBalance,
      source: "ADMIN_ADJUSTMENT",
      voucherId: params.voucherId,
      note: params.note ?? "Refund for failed voucher issuance",
    },
  });

  return user.pointsBalance;
}
