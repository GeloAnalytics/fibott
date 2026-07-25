import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { ProfileForm } from "@/components/shared/profile-form";
import { PasswordForm } from "@/components/shared/password-form";

export default async function ProfilePage() {
  const session = await auth();
  const user = await prisma.user.findUniqueOrThrow({ where: { id: session!.user.id } });

  return (
    <div className="max-w-lg space-y-6">
      <h1 className="text-2xl font-semibold">Profile</h1>
      <ProfileForm name={user.name ?? ""} email={user.email ?? ""} />
      {user.passwordHash && <PasswordForm />}
    </div>
  );
}
