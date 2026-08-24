import "dotenv/config";
import { prisma } from "../src/lib/prisma";

async function main() {
  console.log("Fetching all existing users from database...");
  const users = await prisma.user.findMany();
  console.log(`Found ${users.length} user account(s). Adding 1000 points to each account...\n`);

  for (const user of users) {
    const previousBalance = user.pointsBalance;
    const updatedUser = await prisma.user.update({
      where: { id: user.id },
      data: {
        pointsBalance: {
          increment: 1000,
        },
      },
    });

    await prisma.pointsTransaction.create({
      data: {
        userId: user.id,
        type: "ADJUSTMENT",
        amount: 1000,
        balanceAfter: updatedUser.pointsBalance,
        source: "ADMIN_ADJUSTMENT",
        note: "System bonus: +1000 points awarded to all existing accounts",
      },
    });

    console.log(`✓ User: ${user.email ?? user.name ?? user.id} | Previous: ${previousBalance} pts -> New: ${updatedUser.pointsBalance} pts`);
  }

  console.log("\nSuccessfully added 1000 points to all existing user accounts!");
}

main()
  .catch((e) => {
    console.error("Error adding points:", e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
