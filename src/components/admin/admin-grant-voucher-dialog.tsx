"use client";

import { useState } from "react";
import { Ticket, Copy, Check, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { toast } from "sonner";

interface VoucherRuleOption {
  id: string;
  label: string;
  pointsCost: number;
  durationMinutes: number;
}

interface AdminGrantVoucherDialogProps {
  user: {
    id: string;
    name?: string | null;
    email?: string | null;
  };
  voucherRules: VoucherRuleOption[];
}

interface GrantResult {
  code?: string;
  status?: string;
  durationMinutes?: number;
  message?: string;
}

export function AdminGrantVoucherDialog({ user, voucherRules }: AdminGrantVoucherDialogProps) {
  const [open, setOpen] = useState(false);
  const [voucherRuleId, setVoucherRuleId] = useState(voucherRules[0]?.id ?? "");
  const [submitting, setSubmitting] = useState(false);
  const [grantResult, setGrantResult] = useState<GrantResult | null>(null);
  const [copied, setCopied] = useState(false);

  const handleGrant = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!voucherRuleId) return;
    setSubmitting(true);
    setGrantResult(null);

    try {
      const res = await fetch("/api/admin/vouchers", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userId: user.id, voucherRuleId }),
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to grant voucher");

      setGrantResult({
        code: data.code,
        status: data.status,
        durationMinutes: data.durationMinutes,
        message: data.message,
      });
      toast.success(`Voucher granted to ${user.email ?? user.name}`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Error granting voucher");
    } finally {
      setSubmitting(false);
    }
  };

  const handleCopy = async () => {
    if (!grantResult?.code) return;
    try {
      await navigator.clipboard.writeText(grantResult.code);
      setCopied(true);
      toast.success("Voucher code copied to clipboard!");
      setTimeout(() => setCopied(false), 2000);
    } catch {
      toast.error("Failed to copy code.");
    }
  };

  const handleClose = (isOpen: boolean) => {
    setOpen(isOpen);
    if (!isOpen) {
      setGrantResult(null);
      setVoucherRuleId(voucherRules[0]?.id ?? "");
    }
  };

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogTrigger
        render={
          <Button variant="outline" size="sm" className="h-8 text-xs gap-1.5">
            <Ticket className="size-3.5 text-muted-foreground" />
            Grant Voucher
          </Button>
        }
      />

      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-base">
            <Ticket className="size-4 text-primary" />
            Grant HotSpot Voucher
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-4 pt-2">
          <div className="rounded-lg bg-muted/60 p-3 text-xs space-y-1">
            <p className="font-semibold text-foreground">{user.name ?? "User Account"}</p>
            <p className="text-muted-foreground font-mono">{user.email}</p>
          </div>

          {!grantResult ? (
            <form onSubmit={handleGrant} className="space-y-4">
              {voucherRules.length === 0 ? (
                <p className="text-xs text-muted-foreground">
                  No active voucher rules are configured. Add one under Rewards before granting
                  vouchers.
                </p>
              ) : (
                <div className="space-y-2">
                  <Label htmlFor="voucherRuleId" className="text-xs">
                    Voucher Option
                  </Label>
                  <select
                    id="voucherRuleId"
                    className="h-8 w-full rounded-lg border border-input bg-transparent px-2.5 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 dark:bg-input/30"
                    value={voucherRuleId}
                    onChange={(e) => setVoucherRuleId(e.target.value)}
                    required
                  >
                    {voucherRules.map((rule) => (
                      <option key={rule.id} value={rule.id}>
                        {rule.label} -- {rule.durationMinutes} min
                      </option>
                    ))}
                  </select>
                  <p className="text-[11px] text-muted-foreground">
                    This is a free admin grant -- no points will be deducted from the user&apos;s
                    balance.
                  </p>
                </div>
              )}

              <div className="flex justify-end gap-2 pt-2">
                <Button type="button" variant="outline" size="sm" onClick={() => setOpen(false)}>
                  Cancel
                </Button>
                <Button type="submit" size="sm" disabled={submitting || voucherRules.length === 0}>
                  {submitting && <Loader2 className="size-3.5 animate-spin mr-1" />}
                  {submitting ? "Granting..." : "Grant Voucher"}
                </Button>
              </div>
            </form>
          ) : (
            <div className="space-y-3 pt-1 animate-in fade-in duration-200">
              <div className="rounded-lg border border-emerald-500/30 bg-emerald-500/10 p-3.5 space-y-2">
                <p className="text-xs font-semibold text-emerald-600 dark:text-emerald-400">
                  {grantResult.status === "ISSUED" ? "Voucher Issued!" : "Voucher Generated"}
                </p>
                <p className="text-xs text-muted-foreground">
                  {grantResult.message ??
                    `Valid for ${grantResult.durationMinutes} minutes. Share this code with the user:`}
                </p>
                <div className="flex items-center justify-between font-mono text-sm bg-background p-2.5 rounded border border-border">
                  <span className="font-bold">{grantResult.code}</span>
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
