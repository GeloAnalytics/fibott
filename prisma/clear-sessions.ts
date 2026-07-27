import { config } from "dotenv";
config({ path: ".env.local" });
import { prisma } from "../src/lib/prisma";

async function main() {
  const r = await prisma.depositSession.updateMany({
    where: { status: "ACTIVE" },
    data: { status: "EXPIRED" },
  });
  console.log(`Expired ${r.count} session(s).`);
  await prisma.$disconnect();
}

main().catch((e) => { console.error(e); process.exit(1); });
