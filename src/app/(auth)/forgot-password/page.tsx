import Link from "next/link";
import { ShieldAlert, KeyRound, ArrowLeft, ExternalLink, MapPin } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

function FacebookIcon({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="currentColor"
      className={className}
      aria-hidden="true"
    >
      <path d="M24 12.073c0-6.627-5.373-12-12-12s-12 5.373-12 12c0 5.99 4.388 10.954 10.125 11.854v-8.385H7.078v-3.47h3.047V9.43c0-3.007 1.792-4.669 4.533-4.669 1.312 0 2.686.235 2.686.235v2.953H15.83c-1.491 0-1.956.925-1.956 1.874v2.25h3.328l-.532 3.47h-2.796v8.385C19.612 23.027 24 18.062 24 12.073z" />
    </svg>
  );
}

export default function ForgotPasswordPage() {
  return (
    <Card className="max-w-md mx-auto">
      <CardHeader className="space-y-1">
        <div className="flex items-center gap-2">
          <KeyRound className="size-5 text-primary" />
          <CardTitle className="text-xl">Admin-Assisted Password Reset</CardTitle>
        </div>
        <CardDescription>
          Password resets are verified and handled directly by an administrator.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="rounded-lg border border-primary/20 bg-primary/5 p-3.5 space-y-1.5">
          <div className="flex items-center gap-2 text-xs font-semibold text-foreground">
            <ShieldAlert className="size-4 text-primary" />
            Security Notice
          </div>
          <p className="text-xs text-muted-foreground leading-relaxed">
            For account security and kiosk operational reliability, password resets are processed manually by a <strong className="text-foreground">Fibott Administrator</strong>.
          </p>
        </div>

        <div className="space-y-2 text-xs text-muted-foreground">
          <p className="font-semibold text-foreground">How to reset your password:</p>
          <ol className="list-decimal list-inside space-y-1.5 pl-1">
            <li>Contact the admin via Facebook or in person at the kiosk.</li>
            <li>Provide your registered email address or account username.</li>
            <li>The administrator will update your password in the Admin Directory.</li>
            <li>Sign in using your temporary password, then update it in your Profile.</li>
          </ol>
        </div>

        <div className="space-y-2.5 pt-1">
          <p className="text-xs font-semibold text-foreground">Ways to contact an Admin:</p>

          <a
            href="https://www.facebook.com/Zackyplays"
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center justify-between gap-3 rounded-lg border border-blue-500/25 bg-blue-50/60 hover:bg-blue-100/70 dark:bg-blue-950/25 dark:border-blue-500/30 dark:hover:bg-blue-950/45 p-3 transition-colors group"
          >
            <div className="flex items-center gap-3 min-w-0">
              <div className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-[#1877F2] text-white shadow-xs">
                <FacebookIcon className="size-5" />
              </div>
              <div className="min-w-0 text-left">
                <div className="flex items-center gap-1.5">
                  <span className="text-xs font-semibold text-foreground group-hover:text-[#1877F2] transition-colors truncate">
                    Message on Facebook
                  </span>
                  <span className="inline-flex items-center rounded px-1.5 py-0.5 text-[10px] font-medium bg-emerald-500/10 text-emerald-600 dark:text-emerald-400">
                    Online Support
                  </span>
                </div>
                <p className="text-[11px] text-muted-foreground truncate">
                  facebook.com/Zackyplays
                </p>
              </div>
            </div>
            <ExternalLink className="size-4 shrink-0 text-muted-foreground group-hover:text-foreground transition-colors" />
          </a>

          <div className="flex items-start gap-2.5 rounded-lg border bg-muted/40 p-2.5 text-xs text-muted-foreground">
            <MapPin className="size-4 shrink-0 text-muted-foreground mt-0.5" />
            <p className="text-[11px] leading-relaxed">
              <span className="font-medium text-foreground">At the kiosk:</span> You can also request assistance directly from the kiosk administrator or on-duty staff at the machine.
            </p>
          </div>
        </div>

        <div className="pt-2">
          <Button render={<Link href="/login" />} variant="outline" className="w-full gap-2">
            <ArrowLeft className="size-4" />
            Back to Sign In
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
