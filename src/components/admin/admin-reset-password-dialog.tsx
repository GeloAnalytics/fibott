"use client";

import { useState } from "react";
import { KeyRound, Copy, Check, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { toast } from "sonner";

interface AdminResetPasswordDialogProps {
  user: {
    id: string;
    name?: string | null;
    email?: string | null;
  };
}

export function AdminResetPasswordDialog({ user }: AdminResetPasswordDialogProps) {
  const [open, setOpen] = useState(false);
  const [customPassword, setCustomPassword] = useState("Fibott2026!");
  const [submitting, setSubmitting] = useState(false);
  const [resetResult, setResetResult] = useState<{ newPassword?: string } | null>(null);
  const [copied, setCopied] = useState(false);

  const handleReset = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    setResetResult(null);

    try {
      const res = await fetch("/api/admin/users/reset-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          userId: user.id,
          newPassword: customPassword.trim() || undefined,
        }),
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to reset password");

      setResetResult({ newPassword: data.newPassword });
      toast.success(`Password updated for ${user.email ?? user.name}`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Error resetting password");
    } finally {
      setSubmitting(false);
    }
  };

  const handleCopy = async () => {
    if (!resetResult?.newPassword) return;
    try {
      await navigator.clipboard.writeText(resetResult.newPassword);
      setCopied(true);
      toast.success("Temporary password copied to clipboard!");
      setTimeout(() => setCopied(false), 2000);
    } catch {
      toast.error("Failed to copy password.");
    }
  };

  const handleClose = (isOpen: boolean) => {
    setOpen(isOpen);
    if (!isOpen) {
      setResetResult(null);
      setCustomPassword("Fibott2026!");
    }
  };

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogTrigger
        render={
          <Button variant="outline" size="sm" className="h-8 text-xs gap-1.5">
            <KeyRound className="size-3.5 text-muted-foreground" />
            Reset Password
          </Button>
        }
      />

      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-base">
            <KeyRound className="size-4 text-primary" />
            Admin Password Reset
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-4 pt-2">
          <div className="rounded-lg bg-muted/60 p-3 text-xs space-y-1">
            <p className="font-semibold text-foreground">{user.name ?? "User Account"}</p>
            <p className="text-muted-foreground font-mono">{user.email}</p>
          </div>

          {!resetResult ? (
            <form onSubmit={handleReset} className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="customPassword" className="text-xs">
                  New Password / Temporary Password
                </Label>
                <Input
                  id="customPassword"
                  type="text"
                  className="font-mono text-sm"
                  value={customPassword}
                  onChange={(e) => setCustomPassword(e.target.value)}
                  placeholder="e.g. Fibott2026!"
                  required
                  minLength={6}
                />
                <p className="text-[11px] text-muted-foreground">
                  Default temporary password is <code className="font-mono text-foreground">Fibott2026!</code>.
                </p>
              </div>

              <div className="flex justify-end gap-2 pt-2">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => setOpen(false)}
                >
                  Cancel
                </Button>
                <Button type="submit" size="sm" disabled={submitting}>
                  {submitting && <Loader2 className="size-3.5 animate-spin mr-1" />}
                  {submitting ? "Updating..." : "Update Password"}
                </Button>
              </div>
            </form>
          ) : (
            <div className="space-y-3 pt-1 animate-in fade-in duration-200">
              <div className="rounded-lg border border-emerald-500/30 bg-emerald-500/10 p-3.5 space-y-2">
                <p className="text-xs font-semibold text-emerald-600 dark:text-emerald-400">
                  Password Updated Successfully!
                </p>
                <p className="text-xs text-muted-foreground">
                  Provide these temporary login credentials to the user:
                </p>
                <div className="flex items-center justify-between font-mono text-sm bg-background p-2.5 rounded border border-border">
                  <span className="font-bold">{resetResult.newPassword}</span>
                  <Button
                    type="button"
                    size="sm"
                    variant="ghost"
                    className="h-7 px-2 text-xs gap-1"
                    onClick={handleCopy}
                  >
                    {copied ? <Check className="size-3.5 text-emerald-500" /> : <Copy className="size-3.5" />}
                    {copied ? "Copied" : "Copy"}
                  </Button>
                </div>
              </div>

              <div className="flex justify-end pt-2">
                <Button size="sm" onClick={() => setOpen(false)}>
                  Done
                </Button>
              </div>
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
