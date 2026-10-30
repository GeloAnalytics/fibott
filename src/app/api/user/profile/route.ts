import { NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

const schema = z.object({
  name: z.string().min(1).max(100),
  phone: z.string().max(30).optional().or(z.literal("")),
  address: z.string().max(500).optional().or(z.literal("")),
});

export async function PATCH(req: Request) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await req.json().catch(() => null);
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid input" }, { status: 400 });
  }

  const { name, phone, address } = parsed.data;

  await prisma.user.update({
    where: { id: session.user.id },
    data: {
      name,
      phone: phone || null,
      address: address || null,
    },
  });

  return NextResponse.json({ ok: true });
}
