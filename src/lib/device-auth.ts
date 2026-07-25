import crypto from "crypto";
import bcrypt from "bcryptjs";
import { prisma } from "@/lib/prisma";
import type { DeviceType } from "@/generated/prisma/enums";
import type { Device } from "@/generated/prisma/client";

const KEY_PREFIX = "fibott_dev_";

export async function generateDeviceApiKey(): Promise<{
  plaintext: string;
  hash: string;
  prefix: string;
}> {
  const secret = crypto.randomBytes(24).toString("hex");
  const plaintext = `${KEY_PREFIX}${secret}`;
  const hash = await bcrypt.hash(plaintext, 10);
  const prefix = plaintext.slice(0, KEY_PREFIX.length + 8);
  return { plaintext, hash, prefix };
}

export class DeviceAuthError extends Error {
  status = 401;
  constructor(message = "Invalid or missing device API key") {
    super(message);
  }
}

export async function validateDeviceApiKey(
  req: Request,
  expectedType?: DeviceType
): Promise<Device> {
  const apiKey = req.headers.get("x-device-api-key");
  if (!apiKey) throw new DeviceAuthError();

  const prefix = apiKey.slice(0, KEY_PREFIX.length + 8);
  const candidates = await prisma.device.findMany({
    where: { apiKeyPrefix: prefix, status: "ACTIVE" },
  });

  for (const candidate of candidates) {
    const matches = await bcrypt.compare(apiKey, candidate.apiKeyHash);
    if (matches) {
      if (expectedType && candidate.type !== expectedType) {
        throw new DeviceAuthError("Device type mismatch");
      }
      return prisma.device.update({
        where: { id: candidate.id },
        data: { lastSeenAt: new Date() },
      });
    }
  }

  throw new DeviceAuthError();
}
