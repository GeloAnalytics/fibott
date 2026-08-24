"use client";

import { useState } from "react";
import { Copy, Check, ExternalLink, Wifi, HelpCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";

interface VoucherActionsProps {
  code: string;
  hotspotUrl?: string;
  variant?: "banner" | "compact";
}

export function VoucherActions({
  code,
  hotspotUrl = "http://192.168.88.1/login",
  variant = "banner",
}: VoucherActionsProps) {
  const [copied, setCopied] = useState(false);
  const [showInstructions, setShowInstructions] = useState(false);

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(code);
      setCopied(true);
      toast.success("Voucher code copied to clipboard!");
      setTimeout(() => setCopied(false), 2500);
    } catch {
      toast.error("Failed to copy code. Please highlight and copy manually.");
    }
  };

  const handleUseVoucher = async () => {
    // 1. Copy code automatically first
    try {
      await navigator.clipboard.writeText(code);
      toast.success("Code copied! Opening HotSpot login page...");
    } catch {
      // Ignore if clipboard fails
    }

    // 2. Try pre-filling username & password query params if supported, plus fallback
    const fullUrl = hotspotUrl.includes("?")
      ? `${hotspotUrl}&username=${encodeURIComponent(code)}&password=${encodeURIComponent(code)}`
      : `${hotspotUrl}?username=${encodeURIComponent(code)}&password=${encodeURIComponent(code)}`;

    window.open(fullUrl, "_blank", "noopener,noreferrer");
  };

  if (variant === "compact") {
    return (
      <div className="flex items-center gap-1.5">
        <Button
          type="button"
          size="sm"
          variant="outline"
          className="h-7 px-2 text-xs font-mono gap-1"
          onClick={handleCopy}
          title="Copy voucher code"
        >
          {copied ? (
            <Check className="size-3 text-emerald-500" />
          ) : (
            <Copy className="size-3 text-muted-foreground" />
          )}
          {copied ? "Copied" : "Copy"}
        </Button>
        <Button
          type="button"
          size="sm"
          variant="default"
          className="h-7 px-2.5 text-xs gap-1"
          onClick={handleUseVoucher}
          title="Open HotSpot Login Page"
        >
          <Wifi className="size-3" />
          Use Voucher
        </Button>
      </div>
    );
  }

  return (
    <div className="rounded-xl border border-primary/30 bg-primary/5 p-4 sm:p-5 space-y-4 shadow-xs">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div>
          <div className="flex items-center gap-2">
            <span className="inline-flex size-2 rounded-full bg-emerald-500 animate-pulse" />
            <h3 className="text-sm font-semibold text-foreground">Voucher Ready to Use</h3>
          </div>
          <p className="text-xs text-muted-foreground mt-0.5">
            Use this code to get internet access on the Fibott Wi-Fi network.
          </p>
        </div>

        <div className="flex items-center gap-2 font-mono bg-background border border-border rounded-lg px-3 py-1.5 justify-between sm:justify-start">
          <span className="text-xl font-bold tracking-wider text-foreground">{code}</span>
          <Button
            type="button"
            size="icon"
            variant="ghost"
            className="size-8 ml-2 hover:bg-muted"
            onClick={handleCopy}
            title="Copy Code"
          >
            {copied ? (
              <Check className="size-4 text-emerald-500" />
            ) : (
              <Copy className="size-4 text-muted-foreground" />
            )}
          </Button>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2 pt-1 border-t border-border/50">
        <Button
          type="button"
          size="default"
          className="gap-2 bg-primary text-primary-foreground font-semibold shadow-xs"
          onClick={handleUseVoucher}
        >
          <Wifi className="size-4" />
          Use Voucher (Connect to Wi-Fi)
          <ExternalLink className="size-3.5 opacity-80" />
        </Button>

        <Button
          type="button"
          size="default"
          variant="outline"
          className="gap-1.5"
          onClick={handleCopy}
        >
          {copied ? <Check className="size-4 text-emerald-500" /> : <Copy className="size-4" />}
          {copied ? "Code Copied!" : "Copy Code"}
        </Button>

        <Button
          type="button"
          size="default"
          variant="ghost"
          className="gap-1 text-xs text-muted-foreground ml-auto"
          onClick={() => setShowInstructions(!showInstructions)}
        >
          <HelpCircle className="size-3.5" />
          {showInstructions ? "Hide Instructions" : "How to connect?"}
        </Button>
      </div>

      {showInstructions && (
        <div className="mt-3 p-3.5 rounded-lg bg-background border border-border text-xs space-y-2 text-muted-foreground animate-in fade-in slide-in-from-top-1 duration-200">
          <p className="font-semibold text-foreground">Quick Connection Steps:</p>
          <ol className="list-decimal list-inside space-y-1.5">
            <li>
              Connect your phone/laptop to the open <strong className="text-foreground">Fibott</strong> Wi-Fi network.
            </li>
            <li>
              Click <strong className="text-foreground">"Use Voucher"</strong> above. It copies your code and opens the HotSpot login page.
            </li>
            <li>
              Paste the code <code className="bg-muted px-1.5 py-0.5 rounded font-mono text-foreground">{code}</code> into both the <strong className="text-foreground">Username</strong> and <strong className="text-foreground">Password</strong> fields, then click <strong className="text-foreground">Login</strong>.
            </li>
          </ol>
          <p className="pt-1 text-[11px] italic">
            Direct portal URL: <a href={hotspotUrl} target="_blank" rel="noopener noreferrer" className="underline font-mono text-primary">{hotspotUrl}</a>
          </p>
        </div>
      )}
    </div>
  );
}
