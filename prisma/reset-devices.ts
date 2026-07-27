import { config } from "dotenv";
config({ path: ".env.local" });
import { prisma } from "../src/lib/prisma";

async function main() {
  await prisma.device.deleteMany();
  console.log("Devices deleted.");
  await prisma.$disconnect();
}

main().catch((e) => { console.error(e); process.exit(1); });
