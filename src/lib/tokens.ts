import crypto from "crypto";
import { prisma } from "@/lib/prisma";

const VERIFICATION_TOKEN_TTL_MS = 24 * 60 * 60 * 1000; // 24h
const RESET_TOKEN_TTL_MS = 60 * 60 * 1000; // 1h

function randomToken(): string {
  return crypto.randomBytes(32).toString("hex");
}

export async function createVerificationToken(email: string): Promise<string> {
  await prisma.verificationToken.deleteMany({ where: { identifier: email } });
  const token = randomToken();
  await prisma.verificationToken.create({
    data: {
      identifier: email,
      token,
      expires: new Date(Date.now() + VERIFICATION_TOKEN_TTL_MS),
    },
  });
  return token;
}

export async function consumeVerificationToken(
  email: string,
  token: string
): Promise<boolean> {
  const record = await prisma.verificationToken.findUnique({
    where: { identifier_token: { identifier: email, token } },
  });
  if (!record || record.expires < new Date()) return false;
  await prisma.verificationToken.delete({
    where: { identifier_token: { identifier: email, token } },
  });
  return true;
}

export async function createPasswordResetToken(userId: string): Promise<string> {
  const token = randomToken();
  await prisma.passwordResetToken.create({
    data: {
      userId,
      token,
      expires: new Date(Date.now() + RESET_TOKEN_TTL_MS),
    },
  });
  return token;
}

export async function consumePasswordResetToken(
  token: string
): Promise<{ userId: string } | null> {
  const record = await prisma.passwordResetToken.findUnique({ where: { token } });
  if (!record || record.usedAt || record.expires < new Date()) return null;
  await prisma.passwordResetToken.update({
    where: { token },
    data: { usedAt: new Date() },
  });
  return { userId: record.userId };
}
