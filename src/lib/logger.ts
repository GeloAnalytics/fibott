import { prisma } from "@/lib/prisma";

export interface LogEventParams {
  source?: "HARDWARE" | "SYSTEM";
  level?: "INFO" | "WARN" | "ERROR";
  tag: string;
  message: string;
  details?: string | Record<string, unknown> | null;
  deviceId?: string;
}

export async function logSystemEvent(params: LogEventParams) {
  try {
    const detailsStr =
      typeof params.details === "object" && params.details !== null
        ? JSON.stringify(params.details, null, 2)
        : params.details ?? undefined;

    return await prisma.systemLog.create({
      data: {
        source: params.source ?? "SYSTEM",
        level: params.level ?? "INFO",
        tag: params.tag.toUpperCase(),
        message: params.message,
        details: detailsStr,
        deviceId: params.deviceId,
      },
    });
  } catch (err) {
    console.error("Failed to write SystemLog:", err);
    return null;
  }
}
