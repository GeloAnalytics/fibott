import Link from "next/link";
import { redirect } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { consumeVerificationToken } from "@/lib/tokens";
import { prisma } from "@/lib/prisma";

export default async function VerifyEmailPage({
  searchParams,
}: {
  searchParams: Promise<{ token?: string; email?: string }>;
}) {
  const { token, email } = await searchParams;

  if (!token || !email) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Invalid link</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground">
            This verification link is missing required information.
          </p>
          <Button render={<Link href="/login" />} className="mt-4 w-full">
            Back to sign in
          </Button>
        </CardContent>
      </Card>
    );
  }

  const success = await consumeVerificationToken(email, token);

  if (success) {
    await prisma.user.update({
      where: { email },
      data: { emailVerified: new Date() },
    });
    redirect("/login?verified=1");
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Link expired</CardTitle>
      </CardHeader>
      <CardContent>
        <p className="text-sm text-muted-foreground">
          This verification link is invalid or has expired. Please register again or
          contact support.
        </p>
        <Button render={<Link href="/login" />} className="mt-4 w-full">
          Back to sign in
        </Button>
      </CardContent>
    </Card>
  );
}
