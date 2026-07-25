import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

const SESSION_TTL_MS = 5 * 60 * 1000;

function generateCode(): string {
  return Math.floor(100000 + Math.random() * 900000).toString();
}

export async function POST() {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  let code = generateCode();
  for (let attempt = 0; attempt < 5; attempt++) {
    const existing = await prisma.depositSession.findUnique({ where: { code } });
    if (!existing) break;
    code = generateCode();
  }

  const expiresAt = new Date(Date.now() + SESSION_TTL_MS);
  const depositSession = await prisma.depositSession.create({
    data: {
      code,
      userId: session.user.id,
      expiresAt,
    },
  });

  return NextResponse.json(
    {
      sessionId: depositSession.id,
      code: depositSession.code,
      qrPayload: `fibott://session/${depositSession.code}`,
      expiresAt: depositSession.expiresAt,
    },
    { status: 201 }
  );
}
