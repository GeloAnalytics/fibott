import Link from "next/link";
import { ShieldAlert, KeyRound, ArrowLeft } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

export default function ForgotPasswordPage() {
  return (
    <Card className="max-w-md mx-auto">
      <CardHeader className="space-y-1">
        <div className="flex items-center gap-2">
          <KeyRound className="size-5 text-primary" />
          <CardTitle className="text-xl">Admin-Assisted Password Reset</CardTitle>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="rounded-lg border border-primary/20 bg-primary/5 p-4 space-y-2">
          <div className="flex items-center gap-2 text-sm font-semibold text-foreground">
            <ShieldAlert className="size-4 text-primary" />
            Password Reset Guidance
          </div>
          <p className="text-xs text-muted-foreground leading-relaxed">
            For account security and kiosk operational reliability, password resets are handled directly by a <strong className="text-foreground">Fibott Administrator</strong>.
          </p>
        </div>

        <div className="space-y-2 text-xs text-muted-foreground">
          <p className="font-semibold text-foreground">How to reset your password:</p>
          <ol className="list-decimal list-inside space-y-1.5 pl-1">
            <li>Contact your Fibott kiosk administrator or support team.</li>
            <li>The administrator will update your password in the Admin Directory.</li>
            <li>Sign in using your temporary password, then update your password in your Profile.</li>
          </ol>
        </div>

        <div className="pt-2">
          <Button render={<Link href="/login" />} className="w-full gap-2">
            <ArrowLeft className="size-4" />
            Back to Sign In
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
