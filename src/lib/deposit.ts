import { Prisma } from "@/generated/prisma/client";
import type { MaterialType } from "@/generated/prisma/enums";
import { prisma } from "@/lib/prisma";
import { awardPoints } from "@/lib/points";

type Tx = Prisma.TransactionClient;

export interface ProcessDepositParams {
  deviceId: string;
  sessionCode?: string;
  sessionId?: string;
  materialType: MaterialType;
  classificationLabel: string;
  confidence: number;
  imageUrl?: string | null;
}

export type ProcessDepositResult =
  | {
      decision: "ACCEPT";
      depositId: string;
      pointsAwarded: number;
      userPointsBalance: number;
    }
  | {
      decision: "REJECT";
      depositId: string;
      reason: "UNRECOGNIZED_MATERIAL" | "NO_ACTIVE_SESSION" | "REWARD_RULE_INACTIVE";
    };

/**
 * Shared accept/reject + points-award logic for a single deposit, used by
 * both the pre-classified `/api/device/scan` path and the image-upload
 * `/api/device/deposit-image` path so the two never drift apart.
 */
export async function processDeposit(
  params: ProcessDepositParams
): Promise<ProcessDepositResult> {
  return prisma.$transaction(async (tx: Tx) => {
    const depositSession = params.sessionId
      ? await tx.depositSession.findUnique({ where: { id: params.sessionId } })
      : params.sessionCode
        ? await tx.depositSession.findUnique({ where: { code: params.sessionCode } })
        : null;

    const activeSession =
      depositSession &&
      depositSession.status === "ACTIVE" &&
      depositSession.expiresAt > new Date()
        ? depositSession
        : null;

    const userId = activeSession?.userId ?? null;

    if (params.materialType === "REJECTED") {
      const deposit = await tx.deposit.create({
        data: {
          userId,
          depositSessionId: activeSession?.id,
          deviceId: params.deviceId,
          materialType: params.materialType,
          status: "REJECTED",
          pointsAwarded: 0,
          classificationLabel: params.classificationLabel,
          classificationConfidence: params.confidence,
          imageUrl: params.imageUrl,
        },
      });
      return { decision: "REJECT" as const, depositId: deposit.id, reason: "UNRECOGNIZED_MATERIAL" as const };
    }

    if (!activeSession) {
      const deposit = await tx.deposit.create({
        data: {
          userId: null,
          deviceId: params.deviceId,
          materialType: params.materialType,
          status: "REJECTED",
          pointsAwarded: 0,
          classificationLabel: params.classificationLabel,
          classificationConfidence: params.confidence,
          imageUrl: params.imageUrl,
        },
      });
      return { decision: "REJECT" as const, depositId: deposit.id, reason: "NO_ACTIVE_SESSION" as const };
    }

    const rewardRule = await tx.rewardRule.findUnique({
      where: { materialType: params.materialType },
    });
    if (!rewardRule || !rewardRule.isActive) {
      const deposit = await tx.deposit.create({
        data: {
          userId,
          depositSessionId: activeSession.id,
          deviceId: params.deviceId,
          materialType: params.materialType,
          status: "REJECTED",
          pointsAwarded: 0,
          classificationLabel: params.classificationLabel,
          classificationConfidence: params.confidence,
          imageUrl: params.imageUrl,
        },
      });
      return { decision: "REJECT" as const, depositId: deposit.id, reason: "REWARD_RULE_INACTIVE" as const };
    }

    const deposit = await tx.deposit.create({
      data: {
        userId,
        depositSessionId: activeSession.id,
        deviceId: params.deviceId,
        materialType: params.materialType,
        status: "ACCEPTED",
        pointsAwarded: rewardRule.pointsPerItem,
        classificationLabel: params.classificationLabel,
        classificationConfidence: params.confidence,
        imageUrl: params.imageUrl,
      },
    });

    const balance = await awardPoints(tx, {
      userId: userId!,
      amount: rewardRule.pointsPerItem,
      source: "DEPOSIT",
      depositId: deposit.id,
    });

    await tx.depositSession.update({
      where: { id: activeSession.id },
      data: { status: "COMPLETED", completedAt: new Date() },
    });

    return {
      decision: "ACCEPT" as const,
      depositId: deposit.id,
      pointsAwarded: rewardRule.pointsPerItem,
      userPointsBalance: balance,
    };
  });
}
